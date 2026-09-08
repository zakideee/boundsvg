//! Taffy constraints, completed-result caching, and text owner calls.

use std::collections::HashMap;
use taffy::prelude::*;

use crate::font::FontRegistry;
use crate::text::engine::LegacyUnwrappedGlyphProjection;
use crate::text::types::{
    FitMode, IntrinsicInlineSizes, Language, TextLayoutRequest, TextLayoutResult, TextOrientation,
    WhiteSpaceMode, WrapMode, WritingMode,
};

use super::types::{
    ImageInput, MEASURE_CACHE_MAX, TextInput, parse_feature_settings_opt,
    parse_variation_settings_opt,
};

/// Keep immutable node inputs and completed outputs within one layout.
pub(super) struct MeasureContext<'a> {
    pub(super) owner_session: crate::text::engine::TextLayoutSession<'a>,
    pub(super) font_registry: &'a FontRegistry,
    /// Optional secondary registry for combined lookup
    pub(super) fallback_registry: Option<&'a FontRegistry>,
    pub(super) text_inputs: HashMap<NodeId, TextInput>,
    pub(super) text_path_inputs: HashMap<NodeId, super::types::TextPathInput>,
    pub(super) image_inputs: HashMap<NodeId, ImageInput>,
    pub(super) measure_call_count: usize,
    /// Completed measurements belong to one node and its exact constraints.
    pub(super) measure_cache: HashMap<MeasureCacheKey, (Size<f32>, Option<TextLayoutResult>)>,
    pub(super) measure_cache_hits: usize,
    pub(super) measure_cache_clear_count: usize,
    /// Widths returned to Taffy for a later shrink-to-fit feedback measure.
    pub(super) shrink_to_fit_widths: HashMap<NodeId, f32>,
    /// Raw owner projections are node outputs, independent of measured widths.
    pub(super) legacy_projections: HashMap<NodeId, Option<LegacyUnwrappedGlyphProjection>>,
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

fn measure_intrinsic_inline_sizes(
    text_input: &TextInput,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
) -> Result<IntrinsicInlineSizes, boundtext::TextLayoutError> {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum AvailableSpaceKey {
    Definite(u32),
    MinContent,
    MaxContent,
}

impl From<AvailableSpace> for AvailableSpaceKey {
    fn from(available_space: AvailableSpace) -> Self {
        match available_space {
            AvailableSpace::Definite(size) => Self::Definite(size.to_bits()),
            AvailableSpace::MinContent => Self::MinContent,
            AvailableSpace::MaxContent => Self::MaxContent,
        }
    }
}

/// Text/style/fonts stay immutable for each `NodeId` within this context, so
/// equality needs node identity and constraints rather than a partial style hash.
/// Identify one node measurement without treating its hash as identity.
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent Taffy query and feedback flags are part of complete structural cache equality"
)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(super) struct MeasureCacheKey {
    node_id: NodeId,
    known_width_bits: Option<u32>,
    known_height_bits: Option<u32>,
    available_width: AvailableSpaceKey,
    available_height: AvailableSpaceKey,
    max_width_bits: u32,
    max_height_bits: u32,
    horizontal_constraint_bits: u64,
    width_is_min_content: bool,
    width_is_max_content: bool,
    height_is_min_content: bool,
    is_feedback_candidate: bool,
    is_shrink_to_fit_feedback: bool,
    feedback_width_bits: Option<u32>,
}

pub(super) fn build_legacy_projection(
    text_input: &TextInput,
    font_registry: &FontRegistry,
    fallback_registry: Option<&FontRegistry>,
) -> Option<LegacyUnwrappedGlyphProjection> {
    let families = text_input_font_families(text_input);
    let font_context = crate::font::FontContext {
        registry: font_registry,
        fallback_registry,
        families: &families,
        weight: text_input.font_weight,
        style: &text_input.font_style,
    };
    let shape_options = crate::font::shaping::ShapeOptions {
        writing_mode: text_input.writing_mode.clone(),
        language: text_input.language.clone(),
        vertical_feature_priority: None,
        text_orientation: text_input.text_orientation.clone(),
        font_variation_settings: parse_variation_settings_opt(
            text_input.font_variation_settings.as_deref(),
        ),
        font_feature_settings: parse_feature_settings_opt(
            text_input.font_feature_settings.as_deref(),
        ),
    };
    crate::text::engine::project_legacy_unwrapped_glyphs(
        &text_input.content,
        text_input.font_size_px,
        text_input.letter_spacing_px.unwrap_or(0.0),
        &shape_options,
        &font_context,
    )
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
    measure_cache: &mut HashMap<
        MeasureCacheKey,
        (Size<f32>, Option<crate::text::types::TextLayoutResult>),
    >,
    measure_cache_hits: &mut usize,
    shrink_to_fit_widths: &mut HashMap<NodeId, f32>,
    measure_cache_clear_count: &mut usize,
    legacy_projections: &mut HashMap<NodeId, Option<LegacyUnwrappedGlyphProjection>>,
    owner_session: &mut crate::text::engine::TextLayoutSession<'_>,
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
        let intrinsic =
            measure_intrinsic_inline_sizes(text_input, font_registry, fallback_registry)
                .map_err(|error| render_text_layout_error(&error))?;
        if width_is_min_content {
            max_width = ceil_nonnegative_f32(intrinsic.min_content_inline_size);
        } else if width_is_max_content && max_width >= f32::MAX {
            max_width = ceil_nonnegative_f32(intrinsic.max_content_inline_size);
        }
    }
    let is_shrink_to_fit_feedback = shrink_to_fit_widths
        .get(&node_id)
        .is_some_and(|feedback_width| feedback_width.to_bits() == max_width.to_bits());
    let horizontal_max_width = horizontal_constraint_px(max_width, is_shrink_to_fit_feedback);

    legacy_projections
        .entry(node_id)
        .or_insert_with(|| build_legacy_projection(text_input, font_registry, fallback_registry));
    let cache_key = MeasureCacheKey {
        node_id,
        known_width_bits: known_dimensions.width.map(f32::to_bits),
        known_height_bits: known_dimensions.height.map(f32::to_bits),
        available_width: available_space.width.into(),
        available_height: available_space.height.into(),
        max_width_bits: max_width.to_bits(),
        max_height_bits: max_height.to_bits(),
        horizontal_constraint_bits: horizontal_max_width.to_bits(),
        width_is_min_content,
        width_is_max_content,
        height_is_min_content,
        is_feedback_candidate,
        is_shrink_to_fit_feedback,
        feedback_width_bits: shrink_to_fit_widths
            .get(&node_id)
            .map(|width| width.to_bits()),
    };
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
        .map_err(|error| render_text_layout_error(&error))?;
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
            *measure_cache_clear_count += 1;
        }
        measure_cache.insert(cache_key, (size, Some(rust_result.clone())));
        text_results.insert(node_id, rust_result);
        return Ok(size);
    }

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
        let rust_result = owner_session
            .layout_text(&req, &font_ctx, text_input.unit_map.is_some())
            .map_err(|error| render_text_layout_error(&error))?;
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
            *measure_cache_clear_count += 1;
        }
        measure_cache.insert(cache_key, (size, Some(rust_result.clone())));
        text_results.insert(node_id, rust_result);
        Ok(size)
    }
}

fn render_text_layout_error(error: &boundtext::TextLayoutError) -> crate::error::EngineError {
    crate::text_diagnostics::classify_text_layout_error(
        error,
        crate::text_diagnostics::TextLayoutOperation::RenderTextLayout,
        None,
    )
    .into_engine_error()
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

#[cfg(test)]
mod cache_key_tests {
    use super::{AvailableSpaceKey, MeasureCacheKey};
    use std::collections::HashMap;
    use std::hash::{BuildHasherDefault, Hasher};
    use taffy::prelude::NodeId;

    #[derive(Default)]
    struct CollisionHasher;

    impl Hasher for CollisionHasher {
        fn finish(&self) -> u64 {
            0
        }
        fn write(&mut self, _bytes: &[u8]) {}
    }

    #[test]
    fn full_identity_survives_bucket_collisions_and_presence_bit_changes() {
        let key = MeasureCacheKey {
            node_id: NodeId::new(1),
            known_width_bits: None,
            known_height_bits: None,
            available_width: AvailableSpaceKey::MaxContent,
            available_height: AvailableSpaceKey::MinContent,
            max_width_bits: 100.0_f32.to_bits(),
            max_height_bits: 200.0_f32.to_bits(),
            horizontal_constraint_bits: 100.0_f64.to_bits(),
            width_is_min_content: false,
            width_is_max_content: true,
            height_is_min_content: true,
            is_feedback_candidate: false,
            is_shrink_to_fit_feedback: false,
            feedback_width_bits: None,
        };
        let alternatives = [
            MeasureCacheKey {
                node_id: NodeId::new(2),
                ..key
            },
            MeasureCacheKey {
                known_width_bits: Some(0.0_f32.to_bits()),
                ..key
            },
            MeasureCacheKey {
                known_width_bits: Some((-0.0_f32).to_bits()),
                ..key
            },
            MeasureCacheKey {
                known_height_bits: Some(0),
                ..key
            },
            MeasureCacheKey {
                available_width: AvailableSpaceKey::Definite(0),
                ..key
            },
            MeasureCacheKey {
                available_width: AvailableSpaceKey::MinContent,
                ..key
            },
            MeasureCacheKey {
                available_height: AvailableSpaceKey::Definite(0),
                ..key
            },
            MeasureCacheKey {
                max_width_bits: 100.0_f32.to_bits() + 1,
                ..key
            },
            MeasureCacheKey {
                max_height_bits: 200.0_f32.to_bits() + 1,
                ..key
            },
            MeasureCacheKey {
                horizontal_constraint_bits: 100.0_f64.to_bits() + 1,
                ..key
            },
            MeasureCacheKey {
                width_is_min_content: true,
                ..key
            },
            MeasureCacheKey {
                width_is_max_content: false,
                ..key
            },
            MeasureCacheKey {
                height_is_min_content: false,
                ..key
            },
            MeasureCacheKey {
                is_feedback_candidate: true,
                ..key
            },
            MeasureCacheKey {
                is_shrink_to_fit_feedback: true,
                ..key
            },
            MeasureCacheKey {
                feedback_width_bits: Some(100.0_f32.to_bits()),
                ..key
            },
        ];
        let mut cache = HashMap::<_, _, BuildHasherDefault<CollisionHasher>>::default();
        cache.insert(key, 0);
        for (index, alternative) in alternatives.iter().copied().enumerate() {
            assert_ne!(key, alternative);
            assert!(cache.insert(alternative, index + 1).is_none());
        }
        assert_eq!(cache.get(&key), Some(&0));
        for (index, alternative) in alternatives.iter().enumerate() {
            assert_eq!(cache.get(alternative), Some(&(index + 1)));
        }
    }
}
