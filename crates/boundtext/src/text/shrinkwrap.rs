//! Shrinkwrap: binary search over width to find the minimum width that
//! preserves a given line count.
//!
//! Structurally parallel to [`super::fit`] (which binary-searches over font
//! size), but the search variable is width instead. The `ShapedParagraph` is
//! reused across iterations since font size is constant.

use super::engine::layout_text;
use super::paragraph::{self, ShapedParagraph};
use super::rich;
use super::types::{Language, TextLayoutRequest, TextLayoutResult, WrapMode};
use super::vertical;
use crate::font::FontContext;
use crate::font::shaping::ShapeOptions;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Default convergence epsilon (px).
const DEFAULT_EPSILON: f64 = 0.25;
/// Default max binary search iterations.
const DEFAULT_MAX_ITERATIONS: usize = 12;
const CONTAINMENT_EPSILON_PX: f64 = 1e-6;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Configuration for shrinkwrap binary search.
pub struct ShrinkwrapConfig {
    /// Convergence tolerance in px (default 0.25).
    pub epsilon_px: f64,
    /// Maximum binary search iterations (default 12).
    pub max_iterations: usize,
}

impl Default for ShrinkwrapConfig {
    fn default() -> Self {
        Self {
            epsilon_px: DEFAULT_EPSILON,
            max_iterations: DEFAULT_MAX_ITERATIONS,
        }
    }
}

/// Whether the binary search found a width satisfying the target line count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShrinkwrapStatus {
    /// A minimum width preserving `target_line_count` was found.
    Satisfied,
    /// `max_width` still produces more lines than `target_line_count`.
    /// `chosen_width_px` equals `max_width`; `line_count` is the actual count.
    Infeasible,
}

/// Result of a shrinkwrap search.
#[derive(Debug, Clone)]
pub struct ShrinkwrapResult {
    pub status: ShrinkwrapStatus,
    pub chosen_width_px: f64,
    pub line_count: usize,
    pub used_height: f64,
    pub max_line_width: f64,
}

/// Result of a vertical shrinkwrap search.
#[derive(Debug, Clone)]
pub struct VerticalShrinkwrapResult {
    pub status: ShrinkwrapStatus,
    pub chosen_height_px: f64,
    pub line_count: usize,
    pub used_width: f64,
    pub used_height: f64,
}

fn layout_text_at_inline_size(
    req: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    inline_size_px: f64,
) -> Result<TextLayoutResult, crate::TextLayoutError> {
    let candidate_req = if req.is_vertical() {
        TextLayoutRequest {
            max_height: Some(inline_size_px),
            ..req.clone()
        }
    } else {
        TextLayoutRequest {
            max_width: inline_size_px,
            max_height: None,
            ..req.clone()
        }
    };
    layout_text(&candidate_req, font_ctx)
}

/// Shrinkwrap a horizontal span/rich-text request using the full text engine.
/// This path preserves forced-newline and fallback shaping semantics that the
/// paragraph-only shrinkwrap path cannot represent.
///
/// # Errors
///
/// Returns the first authoritative text-layout failure from a search probe.
pub fn shrinkwrap_text_layout_horizontal(
    req: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    target_line_count: Option<usize>,
    min_width: Option<f64>,
    max_width: f64,
    config: &ShrinkwrapConfig,
) -> Result<ShrinkwrapResult, crate::TextLayoutError> {
    let max_layout = layout_text_at_inline_size(req, font_ctx, max_width)?;
    let target_line_count = target_line_count.unwrap_or(max_layout.lines.len());
    if max_layout.lines.len() > target_line_count
        || max_layout.bbox.w > max_width + CONTAINMENT_EPSILON_PX
    {
        return Ok(horizontal_layout_result(
            ShrinkwrapStatus::Infeasible,
            max_width,
            &max_layout,
        ));
    }

    let intrinsic_min_width =
        rich::measure_intrinsic_inline_size(req, font_ctx)?.min_content_inline_size;
    let effective_min_width = min_width
        .unwrap_or(intrinsic_min_width)
        .max(0.0)
        .min(max_width);
    let min_layout = layout_text_at_inline_size(req, font_ctx, effective_min_width)?;
    if min_layout.lines.len() == target_line_count
        && min_layout.bbox.w <= effective_min_width + CONTAINMENT_EPSILON_PX
    {
        return Ok(horizontal_layout_result(
            ShrinkwrapStatus::Satisfied,
            effective_min_width,
            &min_layout,
        ));
    }
    if min_layout.lines.len() < target_line_count {
        return Ok(horizontal_layout_result(
            ShrinkwrapStatus::Infeasible,
            max_width,
            &max_layout,
        ));
    }

    let mut lower_bound = effective_min_width;
    let mut upper_bound = max_width;
    for _ in 0..config.max_iterations {
        if upper_bound - lower_bound < config.epsilon_px {
            break;
        }
        let midpoint = f64::midpoint(lower_bound, upper_bound);
        let midpoint_layout = layout_text_at_inline_size(req, font_ctx, midpoint)?;
        if midpoint_layout.lines.len() <= target_line_count
            && midpoint_layout.bbox.w <= midpoint + CONTAINMENT_EPSILON_PX
        {
            upper_bound = midpoint;
        } else {
            lower_bound = midpoint;
        }
    }

    let final_layout = layout_text_at_inline_size(req, font_ctx, upper_bound)?;
    let status = if final_layout.lines.len() == target_line_count
        && final_layout.bbox.w <= upper_bound + CONTAINMENT_EPSILON_PX
    {
        ShrinkwrapStatus::Satisfied
    } else {
        ShrinkwrapStatus::Infeasible
    };
    let chosen_width_px = if status == ShrinkwrapStatus::Satisfied {
        upper_bound
    } else {
        max_width
    };
    let result_layout = if status == ShrinkwrapStatus::Satisfied {
        &final_layout
    } else {
        &max_layout
    };
    Ok(horizontal_layout_result(
        status,
        chosen_width_px,
        result_layout,
    ))
}

fn horizontal_layout_result(
    status: ShrinkwrapStatus,
    chosen_width_px: f64,
    layout: &TextLayoutResult,
) -> ShrinkwrapResult {
    ShrinkwrapResult {
        status,
        chosen_width_px,
        line_count: layout.lines.len(),
        used_height: layout.bbox.h,
        max_line_width: layout.bbox.w,
    }
}

/// Vertical counterpart of [`shrinkwrap_text_layout_horizontal`].
///
/// # Errors
///
/// Returns the first authoritative text-layout failure from a search probe.
pub fn shrinkwrap_text_layout_vertical(
    req: &TextLayoutRequest<'_>,
    font_ctx: &FontContext<'_>,
    target_line_count: Option<usize>,
    min_height: Option<f64>,
    max_height: f64,
    max_width: f64,
    config: &ShrinkwrapConfig,
) -> Result<VerticalShrinkwrapResult, crate::TextLayoutError> {
    let max_layout = layout_text_at_inline_size(req, font_ctx, max_height)?;
    let target_line_count = target_line_count.unwrap_or(max_layout.lines.len());
    if max_layout.lines.len() > target_line_count
        || max_layout.bbox.w > max_width + CONTAINMENT_EPSILON_PX
        || max_layout.bbox.h > max_height + CONTAINMENT_EPSILON_PX
    {
        return Ok(vertical_layout_result(
            ShrinkwrapStatus::Infeasible,
            max_height,
            &max_layout,
        ));
    }

    let intrinsic_min_height =
        rich::measure_intrinsic_inline_size(req, font_ctx)?.min_content_inline_size;
    let effective_min_height = min_height
        .unwrap_or(intrinsic_min_height)
        .max(0.0)
        .min(max_height);
    let min_layout = layout_text_at_inline_size(req, font_ctx, effective_min_height)?;
    if min_layout.lines.len() == target_line_count
        && min_layout.bbox.w <= max_width + CONTAINMENT_EPSILON_PX
        && min_layout.bbox.h <= effective_min_height + CONTAINMENT_EPSILON_PX
    {
        return Ok(vertical_layout_result(
            ShrinkwrapStatus::Satisfied,
            effective_min_height,
            &min_layout,
        ));
    }
    if min_layout.lines.len() < target_line_count {
        return Ok(vertical_layout_result(
            ShrinkwrapStatus::Infeasible,
            max_height,
            &max_layout,
        ));
    }

    let mut lower_bound = effective_min_height;
    let mut upper_bound = max_height;
    for _ in 0..config.max_iterations {
        if upper_bound - lower_bound < config.epsilon_px {
            break;
        }
        let midpoint = f64::midpoint(lower_bound, upper_bound);
        let midpoint_layout = layout_text_at_inline_size(req, font_ctx, midpoint)?;
        if midpoint_layout.lines.len() <= target_line_count
            && midpoint_layout.bbox.w <= max_width + CONTAINMENT_EPSILON_PX
            && midpoint_layout.bbox.h <= midpoint + CONTAINMENT_EPSILON_PX
        {
            upper_bound = midpoint;
        } else {
            lower_bound = midpoint;
        }
    }

    let final_layout = layout_text_at_inline_size(req, font_ctx, upper_bound)?;
    let status = if final_layout.lines.len() == target_line_count
        && final_layout.bbox.w <= max_width + CONTAINMENT_EPSILON_PX
        && final_layout.bbox.h <= upper_bound + CONTAINMENT_EPSILON_PX
    {
        ShrinkwrapStatus::Satisfied
    } else {
        ShrinkwrapStatus::Infeasible
    };
    let chosen_height_px = if status == ShrinkwrapStatus::Satisfied {
        upper_bound
    } else {
        max_height
    };
    let result_layout = if status == ShrinkwrapStatus::Satisfied {
        &final_layout
    } else {
        &max_layout
    };
    Ok(vertical_layout_result(
        status,
        chosen_height_px,
        result_layout,
    ))
}

fn vertical_layout_result(
    status: ShrinkwrapStatus,
    chosen_height_px: f64,
    layout: &TextLayoutResult,
) -> VerticalShrinkwrapResult {
    VerticalShrinkwrapResult {
        status,
        chosen_height_px,
        line_count: layout.lines.len(),
        used_width: layout.bbox.w,
        used_height: layout.bbox.h,
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Compute the minimum possible width from shaped data: the widest single
/// character advance (scaled to px). This is the absolute lower bound for any
/// width that can render at least one character per line.
pub fn min_possible_width(pp: &ShapedParagraph, font_size_px: f64) -> f64 {
    if pp.char_advances_funits.is_empty() {
        return 0.0;
    }
    let scale = font_size_px / f64::from(pp.units_per_em);
    let ls = pp.letter_spacing_px;
    pp.char_advances_funits
        .iter()
        .zip(pp.tracking_counts.iter())
        .map(|(&adv, &tc)| (adv as f64) * scale + f64::from(tc) * ls)
        .fold(0.0_f64, f64::max)
}

/// Shrinkwrap pre-shaped vertical text.
///
/// # Errors
///
/// Returns a font or vertical-shaping failure.
pub fn shrinkwrap_vertical_text(
    text: &str,
    font_ctx: &FontContext<'_>,
    font_size_px: f64,
    line_height_px: f64,
    letter_spacing_px: f64,
    language: Language,
    wrap: WrapMode,
    hanging_punctuation: bool,
    shape_options: &ShapeOptions,
    target_line_count: Option<usize>,
    max_width: f64,
    min_height: f64,
    max_height: f64,
    config: &ShrinkwrapConfig,
    force_newline_breaks: bool,
) -> Result<VerticalShrinkwrapResult, crate::TextLayoutError> {
    let glyphs = vertical::shape_text_vertical(
        font_ctx,
        text,
        font_size_px,
        letter_spacing_px,
        shape_options,
    )?;
    let effective_min_height = vertical::min_possible_height(&glyphs, text)
        .max(min_height)
        .min(max_height);

    let measure_at = |candidate_height: f64| {
        vertical::measure_vertical_glyphs(
            &glyphs,
            text,
            candidate_height,
            wrap,
            font_size_px,
            line_height_px,
            language,
            None,
            hanging_punctuation,
            force_newline_breaks,
        )
    };

    let m_max = measure_at(max_height);
    let target_line_count = target_line_count.unwrap_or(m_max.line_count);

    if m_max.line_count > target_line_count || m_max.used_width > max_width {
        return Ok(VerticalShrinkwrapResult {
            status: ShrinkwrapStatus::Infeasible,
            chosen_height_px: max_height,
            line_count: m_max.line_count,
            used_width: m_max.used_width,
            used_height: m_max.used_height,
        });
    }

    let m_min = measure_at(effective_min_height);
    if m_min.line_count == target_line_count && m_min.used_width <= max_width {
        return Ok(VerticalShrinkwrapResult {
            status: ShrinkwrapStatus::Satisfied,
            chosen_height_px: effective_min_height,
            line_count: m_min.line_count,
            used_width: m_min.used_width,
            used_height: m_min.used_height,
        });
    }
    if m_min.line_count < target_line_count {
        return Ok(VerticalShrinkwrapResult {
            status: ShrinkwrapStatus::Infeasible,
            chosen_height_px: max_height,
            line_count: m_max.line_count,
            used_width: m_max.used_width,
            used_height: m_max.used_height,
        });
    }

    let mut lo = effective_min_height;
    let mut hi = max_height;
    for _ in 0..config.max_iterations {
        if hi - lo < config.epsilon_px {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        let m_mid = measure_at(mid);
        if m_mid.line_count <= target_line_count && m_mid.used_width <= max_width {
            hi = mid;
        } else {
            lo = mid;
        }
    }

    let m_hi = measure_at(hi);
    if m_hi.line_count == target_line_count && m_hi.used_width <= max_width {
        Ok(VerticalShrinkwrapResult {
            status: ShrinkwrapStatus::Satisfied,
            chosen_height_px: hi,
            line_count: m_hi.line_count,
            used_width: m_hi.used_width,
            used_height: m_hi.used_height,
        })
    } else {
        Ok(VerticalShrinkwrapResult {
            status: ShrinkwrapStatus::Infeasible,
            chosen_height_px: max_height,
            line_count: m_max.line_count,
            used_width: m_max.used_width,
            used_height: m_max.used_height,
        })
    }
}

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

/// Find the minimum width that preserves `target_line_count` for a shaped
/// paragraph.
///
/// Binary search over width in `[min_width, max_width]`. The `ShapedParagraph`
/// is reused across all iterations (font size is constant).
///
/// Returns [`ShrinkwrapStatus::Infeasible`] if even `max_width` produces more
/// lines than `target_line_count`.
#[must_use]
pub fn shrinkwrap_paragraph(
    pp: &ShapedParagraph,
    font_size_px: f64,
    line_height_px: f64,
    target_line_count: usize,
    min_width: f64,
    max_width: f64,
    wrap: WrapMode,
    config: &ShrinkwrapConfig,
    force_newline_breaks: bool,
) -> ShrinkwrapResult {
    // wrap=None and no forced breaks → always 1 line.
    if wrap == WrapMode::None && !force_newline_breaks {
        let measurement =
            paragraph::measure_paragraph(pp, font_size_px, line_height_px, max_width, wrap, false);
        let status = if measurement.line_count == target_line_count {
            ShrinkwrapStatus::Satisfied
        } else {
            ShrinkwrapStatus::Infeasible
        };
        return ShrinkwrapResult {
            status,
            chosen_width_px: measurement.max_line_width,
            line_count: measurement.line_count,
            used_height: measurement.line_count as f64 * line_height_px,
            max_line_width: measurement.max_line_width,
        };
    }

    // Step 1: check feasibility at max_width.
    let m_max = paragraph::measure_paragraph(
        pp,
        font_size_px,
        line_height_px,
        max_width,
        wrap,
        force_newline_breaks,
    );
    if m_max.line_count > target_line_count {
        // Even at widest, too many lines.
        return ShrinkwrapResult {
            status: ShrinkwrapStatus::Infeasible,
            chosen_width_px: max_width,
            line_count: m_max.line_count,
            used_height: m_max.line_count as f64 * line_height_px,
            max_line_width: m_max.max_line_width,
        };
    }

    // Step 2: check at min_width.
    let m_min = paragraph::measure_paragraph(
        pp,
        font_size_px,
        line_height_px,
        min_width,
        wrap,
        force_newline_breaks,
    );
    if m_min.line_count == target_line_count {
        // Exact match at tightest width.
        return ShrinkwrapResult {
            status: ShrinkwrapStatus::Satisfied,
            chosen_width_px: min_width,
            line_count: m_min.line_count,
            used_height: m_min.line_count as f64 * line_height_px,
            max_line_width: m_min.max_line_width,
        };
    }
    if m_min.line_count < target_line_count {
        // Even at narrowest, can't reach target line count (text too short).
        return ShrinkwrapResult {
            status: ShrinkwrapStatus::Infeasible,
            chosen_width_px: max_width,
            line_count: m_max.line_count,
            used_height: m_max.line_count as f64 * line_height_px,
            max_line_width: m_max.max_line_width,
        };
    }

    // Step 3: binary search.
    // Invariant: lo produces > target lines, hi produces <= target lines.
    // We search for the narrowest width where line_count == target.
    let mut lo = min_width;
    let mut hi = max_width;

    for _ in 0..config.max_iterations {
        if hi - lo < config.epsilon_px {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        let m_mid = paragraph::measure_paragraph(
            pp,
            font_size_px,
            line_height_px,
            mid,
            wrap,
            force_newline_breaks,
        );
        if m_mid.line_count <= target_line_count {
            hi = mid;
        } else {
            lo = mid;
        }
    }

    // Verify exact match at converged width.
    let m_hi = paragraph::measure_paragraph(
        pp,
        font_size_px,
        line_height_px,
        hi,
        wrap,
        force_newline_breaks,
    );
    if m_hi.line_count == target_line_count {
        ShrinkwrapResult {
            status: ShrinkwrapStatus::Satisfied,
            chosen_width_px: hi,
            line_count: m_hi.line_count,
            used_height: m_hi.line_count as f64 * line_height_px,
            max_line_width: m_hi.max_line_width,
        }
    } else {
        // The exact target band was narrower than epsilon or doesn't exist.
        ShrinkwrapResult {
            status: ShrinkwrapStatus::Infeasible,
            chosen_width_px: max_width,
            line_count: m_max.line_count,
            used_height: m_max.line_count as f64 * line_height_px,
            max_line_width: m_max.max_line_width,
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font::shaping::ShapeOptions;
    use crate::font::{FontContext, FontRegistry, FontStyle};
    use crate::text::types::Language;

    fn test_registry() -> FontRegistry {
        let data = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/fonts/NotoSansJP-Regular.subset.ttf"
        ))
        .expect("Test font");
        let mut reg = FontRegistry::new();
        reg.register(data, "NotoSansJP".into(), 400, FontStyle::Normal)
            .unwrap();
        reg
    }

    fn shape(reg: &FontRegistry, text: &str) -> ShapedParagraph {
        let families = vec!["NotoSansJP".to_string()];
        let font_style = FontStyle::Normal;
        let font_ctx = FontContext {
            registry: reg,
            fallback_registry: None,
            families: &families,
            weight: 400,
            style: &font_style,
        };
        paragraph::shape_paragraph(
            text,
            &font_ctx,
            Language::Ja,
            WrapMode::Char,
            false,
            &ShapeOptions::default(),
            None,
            0.0,
        )
        .expect("shape_paragraph should succeed")
    }

    #[test]
    fn shrinkwrap_preserves_line_count() {
        let reg = test_registry();
        let text = "The quick brown fox jumps over the lazy dog";
        let pp = shape(&reg, text);
        let font_size = 16.0;
        let line_height = font_size * 1.5;
        let wide_width = 200.0;

        // Measure at wide width to get reference line count.
        let m_ref = paragraph::measure_paragraph(
            &pp,
            font_size,
            line_height,
            wide_width,
            WrapMode::Char,
            false,
        );
        let target = m_ref.line_count;
        assert!(target >= 1);

        // Shrinkwrap.
        let result = shrinkwrap_paragraph(
            &pp,
            font_size,
            line_height,
            target,
            0.0,
            wide_width,
            WrapMode::Char,
            &ShrinkwrapConfig::default(),
            false,
        );

        assert_eq!(result.status, ShrinkwrapStatus::Satisfied);
        assert!(result.chosen_width_px <= wide_width);
        assert_eq!(result.line_count, target);

        // Verify: re-measure at chosen width still gives same line count.
        let m_check = paragraph::measure_paragraph(
            &pp,
            font_size,
            line_height,
            result.chosen_width_px,
            WrapMode::Char,
            false,
        );
        assert_eq!(m_check.line_count, target);
    }

    #[test]
    fn one_px_narrower_increases_lines() {
        let reg = test_registry();
        let text = "The quick brown fox jumps over the lazy dog near the river bank";
        let pp = shape(&reg, text);
        let font_size = 16.0;
        let line_height = font_size * 1.5;
        let wide_width = 200.0;

        let m_ref = paragraph::measure_paragraph(
            &pp,
            font_size,
            line_height,
            wide_width,
            WrapMode::Char,
            false,
        );
        let target = m_ref.line_count;

        let result = shrinkwrap_paragraph(
            &pp,
            font_size,
            line_height,
            target,
            0.0,
            wide_width,
            WrapMode::Char,
            &ShrinkwrapConfig {
                epsilon_px: 0.1,
                max_iterations: 20,
            },
            false,
        );
        assert_eq!(result.status, ShrinkwrapStatus::Satisfied);

        // Narrowing by 1px should increase line count (or at least not decrease).
        let narrower = (result.chosen_width_px - 1.0).max(0.0);
        let m_narrower = paragraph::measure_paragraph(
            &pp,
            font_size,
            line_height,
            narrower,
            WrapMode::Char,
            false,
        );
        assert!(
            m_narrower.line_count > target,
            "Expected line count > {target} at width {narrower}, got {}",
            m_narrower.line_count,
        );
    }

    #[test]
    fn single_line_returns_max_line_width() {
        let reg = test_registry();
        let text = "short";
        let pp = shape(&reg, text);
        let font_size = 16.0;
        let line_height = font_size * 1.5;
        let wide_width = 1000.0;

        let result = shrinkwrap_paragraph(
            &pp,
            font_size,
            line_height,
            1,
            0.0,
            wide_width,
            WrapMode::Char,
            &ShrinkwrapConfig::default(),
            false,
        );

        assert_eq!(result.status, ShrinkwrapStatus::Satisfied);
        assert_eq!(result.line_count, 1);
        // chosen_width should be close to max_line_width (within epsilon).
        assert!(
            (result.chosen_width_px - result.max_line_width).abs() < 1.0,
            "chosen_width_px ({}) should be close to max_line_width ({})",
            result.chosen_width_px,
            result.max_line_width,
        );
    }

    #[test]
    fn wrap_none_returns_immediately() {
        let reg = test_registry();
        let text = "This text will be on a single line regardless of width";
        let pp = shape(&reg, text);
        let font_size = 16.0;
        let line_height = font_size * 1.5;

        let result = shrinkwrap_paragraph(
            &pp,
            font_size,
            line_height,
            1,
            0.0,
            100.0,
            WrapMode::None,
            &ShrinkwrapConfig::default(),
            false,
        );

        assert_eq!(result.status, ShrinkwrapStatus::Satisfied);
        assert_eq!(result.line_count, 1);
        // For wrap=None, chosen_width equals max_line_width (the actual text width).
        assert!(
            (result.chosen_width_px - result.max_line_width).abs() < f64::EPSILON,
            "wrap=None: chosen_width ({}) should equal max_line_width ({})",
            result.chosen_width_px,
            result.max_line_width,
        );

        // wrap=None with target != 1 must be Infeasible.
        let result_infeasible = shrinkwrap_paragraph(
            &pp,
            font_size,
            line_height,
            3,
            0.0,
            100.0,
            WrapMode::None,
            &ShrinkwrapConfig::default(),
            false,
        );
        assert_eq!(
            result_infeasible.status,
            ShrinkwrapStatus::Infeasible,
            "wrap=None with target != 1 must be Infeasible"
        );
    }

    #[test]
    fn infeasible_target() {
        let reg = test_registry();
        let text = "The quick brown fox jumps over the lazy dog near the river bank";
        let pp = shape(&reg, text);
        let font_size = 16.0;
        let line_height = font_size * 1.5;

        // Use a very narrow max_width where text will wrap to many lines.
        let narrow_width = 50.0;
        let m_narrow = paragraph::measure_paragraph(
            &pp,
            font_size,
            line_height,
            narrow_width,
            WrapMode::Char,
            false,
        );

        // Ask for fewer lines than possible at this width.
        let impossible_target = 1;
        assert!(m_narrow.line_count > impossible_target);

        let result = shrinkwrap_paragraph(
            &pp,
            font_size,
            line_height,
            impossible_target,
            0.0,
            narrow_width,
            WrapMode::Char,
            &ShrinkwrapConfig::default(),
            false,
        );

        assert_eq!(result.status, ShrinkwrapStatus::Infeasible);
        assert_eq!(result.chosen_width_px, narrow_width);
        assert_eq!(result.line_count, m_narrow.line_count);
    }

    #[test]
    fn target_unreachable_is_infeasible() {
        // A single character can never produce more than 1 line, regardless
        // of width. Asking for target_line_count=3 must be Infeasible.
        let reg = test_registry();
        let text = "a";
        let pp = shape(&reg, text);
        let font_size = 16.0;
        let line_height = font_size * 1.5;
        let wide_width = 200.0;

        let result = shrinkwrap_paragraph(
            &pp,
            font_size,
            line_height,
            3,
            0.0,
            wide_width,
            WrapMode::Char,
            &ShrinkwrapConfig::default(),
            false,
        );

        assert_eq!(
            result.status,
            ShrinkwrapStatus::Infeasible,
            "text too short for target: must be Infeasible"
        );
    }

    #[test]
    fn target_narrowing_to_more_lines() {
        // Text produces 2 lines at wide width. Asking for target=3 with enough
        // text should find a narrower width that produces exactly 3 lines.
        let reg = test_registry();
        let text = "The quick brown fox jumps over the lazy dog near the river bank today";
        let pp = shape(&reg, text);
        let font_size = 16.0;
        let line_height = font_size * 1.5;
        let wide_width = 300.0;

        let m_wide = paragraph::measure_paragraph(
            &pp,
            font_size,
            line_height,
            wide_width,
            WrapMode::Char,
            false,
        );
        let actual_lines = m_wide.line_count;

        // Ask for one more line than current.
        let target = actual_lines + 1;

        let result = shrinkwrap_paragraph(
            &pp,
            font_size,
            line_height,
            target,
            0.0,
            wide_width,
            WrapMode::Char,
            &ShrinkwrapConfig::default(),
            false,
        );

        assert_eq!(result.status, ShrinkwrapStatus::Satisfied);
        assert_eq!(result.line_count, target);
        assert!(result.chosen_width_px < wide_width);
    }
}
