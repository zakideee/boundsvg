use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use taffy::prelude::*;

use crate::font::FontRegistry;
use crate::font::line_metrics::{LineMetrics, resolve_line_metrics_for_style};
use crate::text::types::{
    FitMode, InlineRectBlockSizeInput, IntrinsicInlineSizes, Language, RichTextNodeInput,
    RichTextStyleInput, TextDecorationInput, TextDecorationStyle, TextLayoutRequest,
    TextLayoutResult, TextOrientation, WhiteSpaceMode, WrapMode, WritingMode,
};

use super::types::{
    ImageInput, MEASURE_CACHE_MAX, SHAPED_CACHE_MAX, TextInput, parse_feature_settings_opt,
    parse_variation_settings_opt,
};

pub(super) struct MeasureContext<'a> {
    pub(super) font_registry: &'a FontRegistry,
    /// Optional secondary registry for combined lookup
    pub(super) fallback_registry: Option<&'a FontRegistry>,
    pub(super) text_inputs: HashMap<NodeId, TextInput>,
    pub(super) text_path_inputs: HashMap<NodeId, super::types::TextPathInput>,
    pub(super) image_inputs: HashMap<NodeId, ImageInput>,
    pub(super) measure_call_count: usize,
    /// Measure cache: hash(text + style + constraints) → (Size, optional `TextLayoutResult`)
    pub(super) measure_cache:
        HashMap<u64, (Size<f32>, Option<crate::text::types::TextLayoutResult>)>,
    pub(super) measure_cache_hits: usize,
    /// Widths returned to Taffy for a later shrink-to-fit feedback measure.
    pub(super) shrink_to_fit_widths: HashMap<NodeId, f32>,
    /// Width-independent shaped paragraph cache.
    /// Key excludes `max_width`, `max_height`, `max_lines`, fit, ellipsis, `font_size`.
    pub(super) shaped_cache: HashMap<u64, crate::text::paragraph::ShapedParagraph>,
    /// Rust Text Engine results (stored during measure, read during collect)
    pub(super) text_results: HashMap<NodeId, crate::text::types::TextLayoutResult>,
    /// Fatal text errors captured because Taffy's measure callback is infallible.
    pub(super) text_errors: HashMap<NodeId, crate::error::EngineError>,
}

// Taffy measures in f32 while boundtext accumulates advances in f64. Round
// intrinsic answers outward, then reserve one guard ULP only when Taffy feeds
// a measured shrink-to-fit width back into the text engine.
#[expect(
    clippy::cast_possible_truncation,
    reason = "Taffy dimensions are f32 while text measurements are f64"
)]
fn layout_f32(value: f64) -> f32 {
    value as f32
}

fn ceil_nonnegative_f32(value: f64) -> f32 {
    let rounded = layout_f32(value);
    if value > 0.0 && rounded.is_finite() && f64::from(rounded) < value {
        return f32::from_bits(rounded.to_bits() + 1);
    }
    rounded
}

fn horizontal_constraint_px(value: f32, is_shrink_to_fit_feedback: bool) -> f64 {
    if is_shrink_to_fit_feedback && value > 0.0 && value.is_finite() {
        return f64::from(f32::from_bits(value.to_bits() + 1));
    }
    f64::from(value)
}

fn measured_width_px(value: f64, max_width: f32, is_intrinsic_width: bool) -> f32 {
    let measured = if is_intrinsic_width {
        ceil_nonnegative_f32(value)
    } else {
        layout_f32(value)
    };
    measured.min(max_width)
}

fn record_shrink_to_fit_width(
    shrink_to_fit_widths: &mut HashMap<NodeId, f32>,
    node_id: NodeId,
    max_width: f32,
    size: Size<f32>,
    text_result: &TextLayoutResult,
    is_feedback_candidate: bool,
) {
    if is_feedback_candidate
        && text_result.lines.len() == 1
        && text_result.overflow.overflow_type == "none"
        && size.width < max_width
    {
        shrink_to_fit_widths.insert(node_id, size.width);
    }
}

fn text_input_font_families(text_input: &TextInput) -> Vec<String> {
    if text_input.font_family.is_empty() {
        vec!["default".to_string()]
    } else {
        text_input.font_family.clone()
    }
}

fn resolve_text_input_line_metrics(
    text_input: &TextInput,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
) -> LineMetrics {
    let font_families = text_input_font_families(text_input);
    resolve_line_metrics_for_style(
        font_registry,
        fallback_registry,
        &font_families,
        text_input.font_weight,
        &text_input.font_style,
        text_input.font_size_px,
        text_input.line_height,
        text_input.line_height_px,
    )
}

fn measure_intrinsic_inline_sizes(
    text_input: &TextInput,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
) -> Option<IntrinsicInlineSizes> {
    let font_families = text_input_font_families(text_input);
    let font_ctx = crate::font::FontContext {
        registry: font_registry,
        fallback_registry,
        families: &font_families,
        weight: text_input.font_weight,
        style: &text_input.font_style,
    };
    let white_space = WhiteSpaceMode::from_option(text_input.white_space.as_deref());
    let raw_wrap = WrapMode::parse_str(&text_input.wrap);
    let wrap = if white_space == WhiteSpaceMode::NoWrap {
        WrapMode::None
    } else {
        raw_wrap
    };
    let spans_ref = text_input
        .spans
        .as_ref()
        .filter(|spans| !spans.is_empty())
        .map(std::vec::Vec::as_slice);
    let rich_text_ref = text_input
        .rich_text
        .as_ref()
        .filter(|nodes| !nodes.is_empty())
        .map(std::vec::Vec::as_slice);

    let req = TextLayoutRequest {
        text: &text_input.content,
        spans: spans_ref,
        rich_text: rich_text_ref,
        font_size_px: text_input.font_size_px,
        line_height: text_input.line_height,
        line_height_px: text_input.line_height_px,
        letter_spacing_px: text_input.letter_spacing_px.unwrap_or(0.0),
        text_indent: text_input.text_indent,
        max_width: f64::MAX,
        max_height: None,
        wrap,
        white_space,
        tab_size: text_input.tab_size.unwrap_or(4),
        fit: FitMode::None,
        max_lines: None,
        ellipsis: false,
        language: Language::from_option(text_input.language.as_deref()),
        writing_mode: if text_input.writing_mode.as_deref() == Some("vertical-rl") {
            WritingMode::VerticalRl
        } else {
            WritingMode::HorizontalTb
        },
        text_orientation: TextOrientation::from_option(text_input.text_orientation.as_deref()),
        uax14_breaks: None,
        hanging_punctuation: text_input.hanging_punctuation.unwrap_or(false),
        font_variation_settings: parse_variation_settings_opt(
            text_input.font_variation_settings.as_deref(),
        ),
        font_feature_settings: parse_feature_settings_opt(
            text_input.font_feature_settings.as_deref(),
        ),
        min_font_size_px: None,
        shrink_epsilon_px: None,
        shrink_max_iterations: None,
        max_font_size_px: None,
        grow_epsilon_px: None,
        grow_max_iterations: None,
        fit_max_probes: None,
    };

    crate::text::rich::measure_intrinsic_inline_size(&req, &font_ctx)
}

impl MeasureContext<'_> {
    /// Compute a cache key for a measure call.
    pub(super) fn measure_cache_key(
        text_input: &TextInput,
        max_width: f32,
        max_height: f32,
        is_shrink_to_fit_feedback: bool,
    ) -> u64 {
        let mut hasher = DefaultHasher::new();
        text_input.content.hash(&mut hasher);
        if let Some(spans) = &text_input.spans {
            for span in spans {
                span.text.hash(&mut hasher);
                span.font_family.hash(&mut hasher);
                span.font_weight.hash(&mut hasher);
                span.font_style.hash(&mut hasher);
                span.font_size_px.to_bits().hash(&mut hasher);
                span.letter_spacing_px.map(f64::to_bits).hash(&mut hasher);
                span.language.hash(&mut hasher);
                span.text_orientation.hash(&mut hasher);
                span.color.hash(&mut hasher);
                span.font_variation_settings.hash(&mut hasher);
                span.font_feature_settings.hash(&mut hasher);
                hash_text_decoration(span.text_decoration.as_ref(), &mut hasher);
                span.decoration_transport_only.hash(&mut hasher);
            }
        }
        if let Some(rich_text) = &text_input.rich_text {
            hash_rich_text_nodes(rich_text, &mut hasher);
        }
        text_input.font_family.hash(&mut hasher);
        text_input.font_weight.hash(&mut hasher);
        text_input.font_style.hash(&mut hasher);
        // Hash f64 as bits for determinism
        text_input.font_size_px.to_bits().hash(&mut hasher);
        text_input
            .letter_spacing_px
            .map(f64::to_bits)
            .hash(&mut hasher);
        text_input.wrap.hash(&mut hasher);
        text_input.white_space.hash(&mut hasher);
        text_input.tab_size.hash(&mut hasher);
        text_input.max_lines.hash(&mut hasher);
        text_input.writing_mode.hash(&mut hasher);
        text_input.language.hash(&mut hasher);
        text_input.text_orientation.hash(&mut hasher);
        text_input.text_indent.map(f64::to_bits).hash(&mut hasher);
        text_input.font_variation_settings.hash(&mut hasher);
        text_input.font_feature_settings.hash(&mut hasher);
        text_input.unit_map.hash(&mut hasher);
        text_input.text_decoration_range_count.hash(&mut hasher);
        if let Some(flow) = &text_input.flow {
            format!("{flow:?}").hash(&mut hasher);
        }
        // Hash constraints
        max_width.to_bits().hash(&mut hasher);
        max_height.to_bits().hash(&mut hasher);
        is_shrink_to_fit_feedback.hash(&mut hasher);
        hasher.finish()
    }

    /// Width-independent cache key for `ShapedParagraph`.
    /// Excludes: `max_width`, `max_height`, `max_lines`, fit, ellipsis, `font_size`.
    /// `font_size` is excluded because raw shaping is font-size-independent
    /// (`Shaper::shape` does not take `font_size_px`).
    pub(super) fn shaped_cache_key(text_input: &TextInput) -> u64 {
        let mut hasher = DefaultHasher::new();
        text_input.content.hash(&mut hasher);
        text_input.font_family.hash(&mut hasher);
        text_input.font_weight.hash(&mut hasher);
        text_input.font_style.hash(&mut hasher);
        text_input
            .letter_spacing_px
            .map(f64::to_bits)
            .hash(&mut hasher);
        text_input.wrap.hash(&mut hasher);
        text_input.white_space.hash(&mut hasher);
        text_input.tab_size.hash(&mut hasher);
        text_input.language.hash(&mut hasher);
        text_input.writing_mode.hash(&mut hasher);
        text_input.text_orientation.hash(&mut hasher);
        text_input.font_variation_settings.hash(&mut hasher);
        text_input.font_feature_settings.hash(&mut hasher);
        text_input.hanging_punctuation.hash(&mut hasher);
        hasher.finish()
    }
}

fn hash_rich_text_style(style: &RichTextStyleInput, hasher: &mut DefaultHasher) {
    style.font_family.hash(hasher);
    style.font_weight.hash(hasher);
    style.font_style.hash(hasher);
    style.font_size_px.to_bits().hash(hasher);
    style.line_height.map(f64::to_bits).hash(hasher);
    style.line_height_px.map(f64::to_bits).hash(hasher);
    style.letter_spacing_px.map(f64::to_bits).hash(hasher);
    style.language.hash(hasher);
    style.color.hash(hasher);
    style.font_variation_settings.hash(hasher);
    style.font_feature_settings.hash(hasher);
    style.text_orientation.hash(hasher);
    hash_text_decoration(style.text_decoration.as_ref(), hasher);
}

fn hash_text_decoration(decoration: Option<&TextDecorationInput>, hasher: &mut DefaultHasher) {
    let Some(decoration) = decoration else {
        false.hash(hasher);
        return;
    };
    true.hash(hasher);
    decoration.line.hash(hasher);
    decoration.color.hash(hasher);
    match decoration.style {
        TextDecorationStyle::Solid => 0_u8.hash(hasher),
        TextDecorationStyle::Double => 1_u8.hash(hasher),
        TextDecorationStyle::Dotted => 2_u8.hash(hasher),
        TextDecorationStyle::Dashed => 3_u8.hash(hasher),
        TextDecorationStyle::Wavy => 4_u8.hash(hasher),
    }
    decoration.thickness_px.map(f64::to_bits).hash(hasher);
    decoration.offset_px.to_bits().hash(hasher);
}

fn hash_rich_text_nodes(nodes: &[RichTextNodeInput], hasher: &mut DefaultHasher) {
    for node in nodes {
        match node {
            RichTextNodeInput::Text { text } => {
                "text".hash(hasher);
                text.hash(hasher);
            }
            RichTextNodeInput::Span { text, style } => {
                "span".hash(hasher);
                text.hash(hasher);
                hash_rich_text_style(style, hasher);
            }
            RichTextNodeInput::Combine {
                text,
                style,
                decoration_runs,
            } => {
                "combine".hash(hasher);
                text.hash(hasher);
                hash_rich_text_style(style, hasher);
                for run in decoration_runs {
                    run.text.hash(hasher);
                    hash_text_decoration(run.text_decoration.as_ref(), hasher);
                }
            }
            RichTextNodeInput::Ruby {
                ruby_position,
                ruby_align,
                ruby_gap_px,
                ruby_offset_px,
                ruby_line_sizing,
                style,
                base,
                rt,
                rt_levels,
            } => {
                "ruby".hash(hasher);
                ruby_position.hash(hasher);
                ruby_align.hash(hasher);
                ruby_gap_px.map(f64::to_bits).hash(hasher);
                ruby_offset_px.map(f64::to_bits).hash(hasher);
                ruby_line_sizing.hash(hasher);
                hash_rich_text_style(style, hasher);
                hash_rich_text_nodes(base, hasher);
                hash_rich_text_nodes(rt, hasher);
                for level in rt_levels {
                    hash_rich_text_nodes(level, hasher);
                }
            }
            RichTextNodeInput::InlineBox {
                style,
                children,
                padding_inline,
                background,
                border_color,
                border_width,
                border_radius,
                // Provenance-only; identical content measures identically, so
                // the key stays out of the measure-cache hash.
                span_key: _,
            } => {
                "inlineBox".hash(hasher);
                hash_rich_text_style(style, hasher);
                hash_rich_text_nodes(children, hasher);
                if let Some(pi) = padding_inline {
                    pi[0].to_bits().hash(hasher);
                    pi[1].to_bits().hash(hasher);
                }
                background.hash(hasher);
                border_color.hash(hasher);
                border_width.map(f64::to_bits).hash(hasher);
                border_radius.map(f64::to_bits).hash(hasher);
            }
            RichTextNodeInput::InlineRect { rect } => {
                "inlineRect".hash(hasher);
                rect.fragment_id.hash(hasher);
                rect.inline_size_px.to_bits().hash(hasher);
                match rect.block_size_px.as_ref() {
                    Some(InlineRectBlockSizeInput::Pixels(size)) => {
                        0_u8.hash(hasher);
                        size.to_bits().hash(hasher);
                    }
                    Some(InlineRectBlockSizeInput::Line(value)) => {
                        1_u8.hash(hasher);
                        value.hash(hasher);
                    }
                    None => 2_u8.hash(hasher),
                }
                rect.advance_px.map(f64::to_bits).hash(hasher);
                rect.block_align.hash(hasher);
                rect.color.hash(hasher);
                rect.border_radius_px.map(f64::to_bits).hash(hasher);
                rect.opacity.map(f64::to_bits).hash(hasher);
                rect.paint_order.hash(hasher);
            }
            RichTextNodeInput::DecoratedSpan {
                style,
                children,
                padding_inline,
                background,
                border_color,
                border_width,
                border_radius,
                // Provenance-only; identical content measures identically, so
                // the key stays out of the measure-cache hash.
                span_key: _,
            } => {
                "decoratedSpan".hash(hasher);
                hash_rich_text_style(style, hasher);
                hash_rich_text_nodes(children, hasher);
                if let Some(pi) = padding_inline {
                    pi[0].to_bits().hash(hasher);
                    pi[1].to_bits().hash(hasher);
                }
                background.hash(hasher);
                border_color.hash(hasher);
                border_width.map(f64::to_bits).hash(hasher);
                if let Some(br) = border_radius {
                    for v in br {
                        v.to_bits().hash(hasher);
                    }
                }
            }
        }
    }
}

/// Resolve a font entry from the primary registry, falling back to the optional secondary.
pub(super) fn resolve_font_from_registries<'a>(
    font_registry: &'a FontRegistry,
    fallback_registry: Option<&'a FontRegistry>,
    aliases: &[String],
    weight: u16,
    style: &crate::font::FontStyle,
) -> Option<&'a crate::font::FontEntry> {
    if let Some(entry) = font_registry.resolve_chain(aliases, weight, style) {
        return Some(entry);
    }
    if let Some(fallback) = fallback_registry {
        return fallback.resolve_chain(aliases, weight, style);
    }
    None
}

/// Taffy measure callback for text leaf nodes.
///
/// Computes intrinsic size by shaping text with the font registry, applying
/// line-breaking / vertical column-breaking, and caching results.
// text measurement requires font registries, layout dimensions, caches, and node id
#[expect(
    clippy::cast_possible_truncation,
    reason = "f64 layout values converted to f32 at Taffy boundary; precision loss is acceptable for pixel dimensions"
)]
#[expect(
    clippy::too_many_arguments,
    reason = "text layout measure requires font context, metrics, caches, and layout constraints"
)]
pub(super) fn measure_text_node(
    text_input: &TextInput,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
    known_dimensions: Size<Option<f32>>,
    available_space: Size<AvailableSpace>,
    measure_cache: &mut HashMap<u64, (Size<f32>, Option<crate::text::types::TextLayoutResult>)>,
    measure_cache_hits: &mut usize,
    shrink_to_fit_widths: &mut HashMap<NodeId, f32>,
    shaped_cache: &mut HashMap<u64, crate::text::paragraph::ShapedParagraph>,
    node_id: NodeId,
    text_results: &mut HashMap<NodeId, crate::text::types::TextLayoutResult>,
) -> Result<Size<f32>, crate::error::EngineError> {
    let is_vertical = text_input.writing_mode.as_deref() == Some("vertical-rl");
    let width_is_min_content = known_dimensions.width.is_none()
        && matches!(available_space.width, AvailableSpace::MinContent);
    let width_is_max_content = known_dimensions.width.is_none()
        && matches!(available_space.width, AvailableSpace::MaxContent);
    let height_is_min_content = known_dimensions.height.is_none()
        && matches!(available_space.height, AvailableSpace::MinContent);
    let is_feedback_candidate = !is_vertical
        && known_dimensions.width.is_none()
        && matches!(available_space.width, AvailableSpace::Definite(_));

    let mut max_width = known_dimensions
        .width
        .or(match available_space.width {
            AvailableSpace::Definite(w) => Some(w),
            _ => None,
        })
        .unwrap_or(f32::MAX);

    let mut max_height = known_dimensions
        .height
        .or(match available_space.height {
            AvailableSpace::Definite(h) => Some(h),
            _ => None,
        })
        .unwrap_or(f32::MAX);

    // preferredFrame constrains text measurement inside the Taffy layout box.
    // Min-content queries must still report the intrinsic minimum, while every
    // other query uses the tighter of Taffy's available size and the preferred
    // measurement frame. Authored/known dimensions continue to control the box.
    if let Some(ref pf) = text_input.preferred_frame {
        if !width_is_min_content {
            if let Some(pw) = pf.w {
                max_width = max_width.min(pw);
            }
        }
        if !height_is_min_content {
            if let Some(ph) = pf.h {
                max_height = max_height.min(ph);
            }
        }
    }

    // Horizontal text answers Taffy's min/max-content width query with boundtext
    // intrinsic inline sizes. Vertical text has orthogonal flow — its width follows
    // the container's block size and the resolved column layout, so its intrinsic
    // width is taken from the measured bbox below, not overridden here. Overriding
    // it to a single column clamps multi-column runs and pushes them outside the
    // parent.
    if !is_vertical && (width_is_min_content || width_is_max_content) {
        if let Some(intrinsic) =
            measure_intrinsic_inline_sizes(text_input, font_registry, fallback_registry)
        {
            if width_is_min_content {
                max_width = ceil_nonnegative_f32(intrinsic.min_content_inline_size);
            } else if width_is_max_content && max_width >= f32::MAX {
                max_width = ceil_nonnegative_f32(intrinsic.max_content_inline_size);
            }
        }
    }
    let is_shrink_to_fit_feedback = shrink_to_fit_widths
        .get(&node_id)
        .is_some_and(|feedback_width| feedback_width.to_bits() == max_width.to_bits());
    let horizontal_max_width = horizontal_constraint_px(max_width, is_shrink_to_fit_feedback);

    // Check measure cache (width-dependent)
    let cache_key = MeasureContext::measure_cache_key(
        text_input,
        max_width,
        max_height,
        is_shrink_to_fit_feedback,
    );
    if let Some(cached) = measure_cache.get(&cache_key) {
        *measure_cache_hits += 1;
        if let Some(ref tr) = cached.1 {
            record_shrink_to_fit_width(
                shrink_to_fit_widths,
                node_id,
                max_width,
                cached.0,
                tr,
                is_feedback_candidate,
            );
            text_results.insert(node_id, tr.clone());
        }
        return Ok(cached.0);
    }

    if text_input.flow.is_some() && max_width < f32::MAX && max_height < f32::MAX {
        let rust_result = crate::flow::layout_resolved_text_flow(
            text_input,
            horizontal_max_width,
            f64::from(max_height),
            font_registry,
            fallback_registry,
        )
        .map_err(|error| error.into_engine_error(None))?;
        let size = Size {
            width: measured_width_px(
                rust_result.bbox.w,
                max_width,
                width_is_min_content || width_is_max_content,
            ),
            height: rust_result.bbox.h as f32,
        };
        record_shrink_to_fit_width(
            shrink_to_fit_widths,
            node_id,
            max_width,
            size,
            &rust_result,
            is_feedback_candidate,
        );
        if measure_cache.len() >= MEASURE_CACHE_MAX {
            measure_cache.clear();
        }
        measure_cache.insert(cache_key, (size, Some(rust_result.clone())));
        text_results.insert(node_id, rust_result);
        return Ok(size);
    }

    // --- Shaped paragraph cache: reuse shaping across different widths ---
    // Eligible: plain horizontal, no fit, no ellipsis, no inline runs, no rich text,
    // no text_indent (engine.rs routes text_indent != 0 to the rich text path).
    let has_spans = text_input.spans.as_ref().is_some_and(|s| !s.is_empty());
    let has_rich = text_input
        .rich_text
        .as_ref()
        .is_some_and(|nodes| !nodes.is_empty());
    let is_fit = matches!(text_input.fit.as_deref(), Some("shrink" | "grow"));
    let has_ellipsis = text_input.ellipsis.unwrap_or(false);
    let has_indent = text_input.text_indent.unwrap_or(0.0) != 0.0;

    if !has_spans && !has_rich && !is_vertical && !is_fit && !has_ellipsis && !has_indent {
        let shape_key = MeasureContext::shaped_cache_key(text_input);

        // Resolve whiteSpace mode for this fast path (mirrors engine.rs logic)
        let white_space =
            crate::text::types::WhiteSpaceMode::from_option(text_input.white_space.as_deref());
        let force_newline_breaks = white_space == crate::text::types::WhiteSpaceMode::PreWrap;

        // Preprocess plain text for white-space handling before shaping.
        let preprocessed = crate::text::types::preprocess_text_for_white_space(
            &text_input.content,
            white_space,
            text_input.tab_size.unwrap_or(4),
        );
        let content = preprocessed.as_str();

        // Get or create ShapedParagraph
        if !shaped_cache.contains_key(&shape_key) {
            let font_families: Vec<String> = if text_input.font_family.is_empty() {
                vec!["default".to_string()]
            } else {
                text_input.font_family.clone()
            };
            let font_ctx = crate::font::FontContext {
                registry: font_registry,
                fallback_registry,
                families: &font_families,
                weight: text_input.font_weight,
                style: &text_input.font_style,
            };
            let shape_options = crate::font::shaping::ShapeOptions {
                writing_mode: None,
                language: text_input
                    .language
                    .as_ref()
                    .map(std::string::ToString::to_string),
                vertical_feature_priority: None,
                text_orientation: None,
                font_variation_settings: parse_variation_settings_opt(
                    text_input.font_variation_settings.as_deref(),
                ),
                font_feature_settings: parse_feature_settings_opt(
                    text_input.font_feature_settings.as_deref(),
                ),
            };
            let wrap = crate::text::types::WrapMode::parse_str(&text_input.wrap);
            let language =
                crate::text::types::Language::from_option(text_input.language.as_deref());

            // PreWrap text may contain \n which produces .notdef glyphs;
            // allow_notdef lets them through so the paragraph path handles
            // forced newline breaks instead of falling to the legacy path.
            if let Some(pp) = crate::text::paragraph::shape_paragraph_with_options(
                content,
                &font_ctx,
                language,
                wrap,
                text_input.hanging_punctuation.unwrap_or(false),
                &shape_options,
                None,
                text_input.letter_spacing_px.unwrap_or(0.0),
                force_newline_breaks,
            ) {
                if shaped_cache.len() >= SHAPED_CACHE_MAX {
                    shaped_cache.clear();
                }
                shaped_cache.insert(shape_key, pp);
            }
        }

        // If we have a shaped paragraph, use it for layout (skipping re-shaping).
        if let Some(pp) = shaped_cache.get(&shape_key) {
            let raw_wrap = crate::text::types::WrapMode::parse_str(&text_input.wrap);
            let effective_wrap = if white_space == crate::text::types::WhiteSpaceMode::NoWrap {
                crate::text::types::WrapMode::None
            } else {
                raw_wrap
            };
            let line_metrics =
                resolve_text_input_line_metrics(text_input, font_registry, fallback_registry);
            let line_height_px = line_metrics.line_height_px;
            let mut break_result = crate::text::paragraph::layout_paragraph(
                pp,
                text_input.font_size_px,
                line_height_px,
                line_metrics.baseline_offset_px,
                horizontal_max_width,
                effective_wrap,
                force_newline_breaks,
            );

            crate::text::engine::apply_variation_settings_to_lines(
                &mut break_result.lines,
                &parse_variation_settings_opt(text_input.font_variation_settings.as_deref()),
            );
            crate::text::engine::apply_feature_settings_to_lines(
                &mut break_result.lines,
                &parse_feature_settings_opt(text_input.font_feature_settings.as_deref()),
            );

            // Apply maxLines truncation
            let total_line_count = break_result.lines.len();
            let truncated_lines = if let Some(max) = text_input.max_lines {
                if break_result.lines.len() > max {
                    break_result.lines.into_iter().take(max).collect()
                } else {
                    break_result.lines
                }
            } else {
                break_result.lines
            };

            // PreWrap: convert spaces to NBSP to prevent SVG whitespace collapsing
            let mut final_lines = truncated_lines;
            if force_newline_breaks {
                for line in &mut final_lines {
                    if let Some(glyphs) = &mut line.positioned_glyphs {
                        for glyph in glyphs {
                            if glyph.text.contains(' ') {
                                glyph.text = glyph.text.replace(' ', "\u{00A0}");
                            }
                        }
                    }
                }
            }

            let rust_result = crate::text::engine::build_horizontal_result_with_constraints(
                final_lines,
                total_line_count,
                line_height_px,
                text_input.font_size_px,
                break_result.kinsoku_unresolved,
                Some(horizontal_max_width),
                if max_height < f32::MAX {
                    Some(f64::from(max_height))
                } else {
                    None
                },
                Vec::new(),
            );

            let size = Size {
                width: measured_width_px(
                    rust_result.bbox.w,
                    max_width,
                    width_is_min_content || width_is_max_content,
                ),
                height: rust_result.bbox.h as f32,
            };
            record_shrink_to_fit_width(
                shrink_to_fit_widths,
                node_id,
                max_width,
                size,
                &rust_result,
                is_feedback_candidate,
            );

            if measure_cache.len() >= MEASURE_CACHE_MAX {
                measure_cache.clear();
            }
            measure_cache.insert(cache_key, (size, Some(rust_result.clone())));
            text_results.insert(node_id, rust_result);
            return Ok(size);
        }
    }

    // --- Try the Rust Text Engine ---
    {
        let font_families: Vec<String> = if text_input.font_family.is_empty() {
            vec!["default".to_string()]
        } else {
            text_input.font_family.clone()
        };
        let font_weight_u16 = text_input.font_weight;
        let font_style_enum = text_input.font_style.clone();

        let spans_ref = text_input
            .spans
            .as_ref()
            .filter(|s| !s.is_empty())
            .map(std::vec::Vec::as_slice);
        let rich_text_ref = text_input
            .rich_text
            .as_ref()
            .filter(|nodes| !nodes.is_empty())
            .map(std::vec::Vec::as_slice);

        let req = crate::text::types::TextLayoutRequest {
            text: &text_input.content,
            spans: spans_ref,
            rich_text: rich_text_ref,
            font_size_px: text_input.font_size_px,
            line_height: text_input.line_height,
            line_height_px: text_input.line_height_px,
            letter_spacing_px: text_input.letter_spacing_px.unwrap_or(0.0),
            text_indent: text_input.text_indent,
            max_width: if is_vertical {
                f64::from(max_width)
            } else {
                horizontal_max_width
            },
            max_height: if max_height < f32::MAX {
                Some(f64::from(max_height))
            } else {
                None
            },
            wrap: crate::text::types::WrapMode::parse_str(&text_input.wrap),
            white_space: crate::text::types::WhiteSpaceMode::from_option(
                text_input.white_space.as_deref(),
            ),
            tab_size: text_input.tab_size.unwrap_or(4),
            fit: match text_input.fit.as_deref() {
                Some("shrink") => crate::text::types::FitMode::Shrink,
                Some("grow") => crate::text::types::FitMode::Grow,
                _ => crate::text::types::FitMode::None,
            },
            max_lines: text_input.max_lines,
            ellipsis: text_input.ellipsis.unwrap_or(false),
            language: crate::text::types::Language::from_option(text_input.language.as_deref()),
            writing_mode: if is_vertical {
                crate::text::types::WritingMode::VerticalRl
            } else {
                crate::text::types::WritingMode::HorizontalTb
            },
            text_orientation: crate::text::types::TextOrientation::from_option(
                text_input.text_orientation.as_deref(),
            ),
            uax14_breaks: None,
            hanging_punctuation: text_input.hanging_punctuation.unwrap_or(false),
            font_variation_settings: parse_variation_settings_opt(
                text_input.font_variation_settings.as_deref(),
            ),
            font_feature_settings: parse_feature_settings_opt(
                text_input.font_feature_settings.as_deref(),
            ),
            min_font_size_px: text_input.min_font_size_px,
            shrink_epsilon_px: text_input.shrink_epsilon_px,
            shrink_max_iterations: text_input.shrink_max_iterations,
            max_font_size_px: text_input.max_font_size_px,
            grow_epsilon_px: text_input.grow_epsilon_px,
            grow_max_iterations: text_input.grow_max_iterations,
            fit_max_probes: text_input.fit_max_probes,
        };

        let font_ctx = crate::font::FontContext {
            registry: font_registry,
            fallback_registry,
            families: &font_families,
            weight: font_weight_u16,
            style: &font_style_enum,
        };
        let rust_result = if text_input.unit_map.is_some() {
            crate::text::engine::layout_text_with_unit_metadata(&req, &font_ctx)
        } else {
            crate::text::engine::layout_text(&req, &font_ctx)
        }
        .map_err(|error| {
            let code = match &error {
                boundtext::TextLayoutError::EllipsisCandidateLimit { .. } => {
                    "TEXT_ELLIPSIS_CANDIDATE_LIMIT"
                }
                boundtext::TextLayoutError::InvalidFitStep => "TEXT_FIT_INVALID_STEP",
                boundtext::TextLayoutError::FitProbeLimit { .. } => "TEXT_FIT_PROBE_LIMIT",
                boundtext::TextLayoutError::RichTextDepthLimit { .. } => "RICH_TEXT_MAX_DEPTH",
                boundtext::TextLayoutError::InlineRectLimit { .. } => {
                    "INLINE_RECT_COMPLEXITY_LIMIT"
                }
                boundtext::TextLayoutError::PreparationFailed => "TEXT_NO_LAYOUT",
            };
            crate::error::EngineError::Structured {
                code: code.to_string(),
                message: error.to_string(),
                stage: Some("text".to_string()),
                node_id: None,
            }
        })?;
        let size = Size {
            width: measured_width_px(
                rust_result.bbox.w,
                max_width,
                width_is_min_content || width_is_max_content,
            ),
            height: rust_result.bbox.h as f32,
        };
        record_shrink_to_fit_width(
            shrink_to_fit_widths,
            node_id,
            max_width,
            size,
            &rust_result,
            is_feedback_candidate,
        );

        if measure_cache.len() >= MEASURE_CACHE_MAX {
            measure_cache.clear();
        }
        measure_cache.insert(cache_key, (size, Some(rust_result.clone())));
        text_results.insert(node_id, rust_result);
        Ok(size)
    }
}

#[cfg(test)]
mod text_constraint_tests {
    use super::{ceil_nonnegative_f32, horizontal_constraint_px, measured_width_px};

    #[test]
    fn rounds_only_intrinsic_widths_up_to_the_next_f32() {
        let lower = 100.0_f32;
        let intrinsic_width = f64::from(lower) + f64::from(f32::EPSILON);
        let upper = f32::from_bits(lower.to_bits() + 1);

        assert_eq!(ceil_nonnegative_f32(intrinsic_width), upper);
        assert_eq!(horizontal_constraint_px(upper, false), f64::from(upper));
        assert_eq!(
            horizontal_constraint_px(upper, true),
            f64::from(f32::from_bits(upper.to_bits() + 1))
        );
        assert_eq!(measured_width_px(intrinsic_width, upper, true), upper);
        assert_eq!(measured_width_px(intrinsic_width, lower, false), lower);
        assert_eq!(ceil_nonnegative_f32(0.0), 0.0);
        assert_eq!(ceil_nonnegative_f32(f64::INFINITY), f32::INFINITY);
        assert!(ceil_nonnegative_f32(f64::NAN).is_nan());
    }
}
