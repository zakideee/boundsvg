use crate::BoundtextError;
use crate::text::paragraph;
use crate::text::types::WrapMode;

use super::{
    FitSearchKind, FlowBounds, FlowOverflowReason, RegionProvider,
    measure_flow_vertical_with_budgeted_provider, measure_flow_with_budgeted_provider,
};

// ---------------------------------------------------------------------------
// Fit binary search helpers
// ---------------------------------------------------------------------------

/// Default lower bound for shrink-to-fit.
pub(crate) const DEFAULT_MIN_FONT_SIZE: f64 = 8.0;
/// Default font-size search step, in px.
pub(crate) const DEFAULT_FIT_EPSILON: f64 = 0.25;
/// Default iteration cap for certified monotone binary search.
pub(crate) const DEFAULT_FIT_MAX_ITERATIONS: usize = 12;
/// Default probe cap for uncertified exact-grid search.
pub(crate) const DEFAULT_FIT_PROBES_MAX: usize = 4_096;
/// Absolute probe cap accepted from public input.
pub(crate) const HARD_FIT_PROBES_MAX: usize = 65_536;
/// Default upper-bound multiplier for grow-to-fit.
pub(crate) const DEFAULT_GROW_MULTIPLIER: f64 = 4.0;

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "the finite non-negative ceil is range-checked against usize before conversion"
)]
fn exact_grid_probe_count(lower: f64, upper: f64, step: f64) -> Result<usize, BoundtextError> {
    if !step.is_finite() || step <= 0.0 {
        return Err(BoundtextError::InvalidFitStep);
    }
    let span = (upper - lower).max(0.0);
    let intervals = (span / step).ceil();
    if !intervals.is_finite() || intervals > (usize::MAX - 1) as f64 {
        return Ok(usize::MAX);
    }
    Ok(intervals as usize + 1)
}

fn exact_grid_limit(requested: Option<usize>) -> usize {
    requested
        .unwrap_or(DEFAULT_FIT_PROBES_MAX)
        .min(HARD_FIT_PROBES_MAX)
}

/// Validate the exact-grid probe count before evaluating any candidate.
///
/// # Errors
///
/// Returns [`BoundtextError::InvalidFitStep`] for an invalid step or
/// [`BoundtextError::FitProbeLimit`] when the requested grid exceeds its cap.
pub(crate) fn ensure_grid_budget(
    lower: f64,
    upper: f64,
    step: f64,
    requested: Option<usize>,
) -> Result<usize, BoundtextError> {
    let required = exact_grid_probe_count(lower, upper, step)?;
    let limit = exact_grid_limit(requested);
    if required > limit {
        return Err(BoundtextError::FitProbeLimit { required, limit });
    }
    Ok(required)
}

/// Return one descending exact-grid candidate, including the lower endpoint.
pub(crate) fn descending_grid_candidate(
    lower: f64,
    upper: f64,
    step: f64,
    index: usize,
    count: usize,
) -> f64 {
    if index + 1 == count {
        lower
    } else {
        (upper - index as f64 * step).max(lower)
    }
}

fn evaluate_fit_probe(
    is_candidate_fit: &mut impl FnMut(f64) -> Result<bool, BoundtextError>,
    candidate: f64,
) -> Result<bool, BoundtextError> {
    #[cfg(any(test, feature = "phase-trace"))]
    crate::phase_trace::record_fit_probe();
    is_candidate_fit(candidate)
}

/// Select a shrink candidate under the declared monotonicity contract.
///
/// # Errors
///
/// Returns a typed budget or candidate-evaluation failure.
pub(crate) fn fit_shrink_with(
    font_size_px: f64,
    min_size: f64,
    epsilon: f64,
    max_iter: usize,
    search_kind: FitSearchKind,
    max_probes: Option<usize>,
    mut is_candidate_fit: impl FnMut(f64) -> Result<bool, BoundtextError>,
) -> Result<(f64, Option<FlowOverflowReason>), BoundtextError> {
    let min_size = min_size.max(f64::EPSILON).min(font_size_px);
    if search_kind == FitSearchKind::Uncertified {
        let probe_count = ensure_grid_budget(min_size, font_size_px, epsilon, max_probes)?;
        for index in 0..probe_count {
            let candidate =
                descending_grid_candidate(min_size, font_size_px, epsilon, index, probe_count);
            if evaluate_fit_probe(&mut is_candidate_fit, candidate)? {
                return Ok((candidate, None));
            }
        }
        return Ok((min_size, Some(FlowOverflowReason::CannotFit)));
    }
    if evaluate_fit_probe(&mut is_candidate_fit, font_size_px)? {
        return Ok((font_size_px, None));
    }
    if !evaluate_fit_probe(&mut is_candidate_fit, min_size)? {
        return Ok((min_size, Some(FlowOverflowReason::CannotFit)));
    }

    let (mut lo, mut hi) = (min_size, font_size_px);
    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        if evaluate_fit_probe(&mut is_candidate_fit, mid)? {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Ok((lo, None))
}

/// Select a grow candidate under the declared monotonicity contract.
///
/// # Errors
///
/// Returns a typed budget or candidate-evaluation failure.
pub(crate) fn fit_grow_with(
    font_size_px: f64,
    max_size: f64,
    epsilon: f64,
    max_iter: usize,
    search_kind: FitSearchKind,
    max_probes: Option<usize>,
    mut is_candidate_fit: impl FnMut(f64) -> Result<bool, BoundtextError>,
) -> Result<(f64, Option<FlowOverflowReason>), BoundtextError> {
    let max_size = max_size.max(font_size_px);
    if search_kind == FitSearchKind::Uncertified {
        let probe_count = ensure_grid_budget(font_size_px, max_size, epsilon, max_probes)?;
        if !evaluate_fit_probe(&mut is_candidate_fit, font_size_px)? {
            return Ok((font_size_px, Some(FlowOverflowReason::CannotFit)));
        }
        for index in 0..probe_count {
            let candidate =
                descending_grid_candidate(font_size_px, max_size, epsilon, index, probe_count);
            if index + 1 == probe_count {
                return Ok((font_size_px, None));
            }
            if evaluate_fit_probe(&mut is_candidate_fit, candidate)? {
                return Ok((candidate, None));
            }
        }
        return Ok((font_size_px, Some(FlowOverflowReason::CannotFit)));
    }
    if !evaluate_fit_probe(&mut is_candidate_fit, font_size_px)? {
        return Ok((font_size_px, Some(FlowOverflowReason::CannotFit)));
    }
    if evaluate_fit_probe(&mut is_candidate_fit, max_size)? {
        return Ok((max_size, None));
    }

    let (mut lo, mut hi) = (font_size_px, max_size);
    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        if evaluate_fit_probe(&mut is_candidate_fit, mid)? {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Ok((lo, None))
}

/// Check whether all text is consumed at a given font size.
fn flow_fits_at_size(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    line_height_px: f64,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_width_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<bool, BoundtextError> {
    let min_region_width = min_region_width_fixed.unwrap_or(font_size_px);
    measure_flow_with_budgeted_provider(
        pp,
        font_size_px,
        line_height_px,
        fb,
        region_provider,
        min_region_width,
        max_lines,
        wrap,
    )
    .map(|measure| measure.fits())
}

/// Select the largest font size in `[min_size, font_size_px]` that fits all
/// text, using the provider's declared search contract.
///
/// # Errors
///
/// Returns a typed budget, geometry-provider, or candidate-layout failure.
pub(super) fn flow_fit_shrink(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    min_size: f64,
    epsilon: f64,
    max_iter: usize,
    max_probes: Option<usize>,
    mut resolve_line_height_px: impl FnMut(f64) -> f64,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_width_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<(f64, Option<FlowOverflowReason>), BoundtextError> {
    fit_shrink_with(
        font_size_px,
        min_size,
        epsilon,
        max_iter,
        region_provider.fit_search_kind(),
        max_probes,
        |candidate| {
            flow_fits_at_size(
                pp,
                candidate,
                resolve_line_height_px(candidate),
                fb,
                region_provider,
                min_region_width_fixed,
                max_lines,
                wrap,
            )
        },
    )
}

/// Select the largest font size in `[font_size_px, max_size]` that fits all
/// text, using the provider's declared search contract.
///
/// # Errors
///
/// Returns a typed budget, geometry-provider, or candidate-layout failure.
pub(super) fn flow_fit_grow(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    max_size: f64,
    epsilon: f64,
    max_iter: usize,
    max_probes: Option<usize>,
    mut resolve_line_height_px: impl FnMut(f64) -> f64,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_width_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<(f64, Option<FlowOverflowReason>), BoundtextError> {
    fit_grow_with(
        font_size_px,
        max_size,
        epsilon,
        max_iter,
        region_provider.fit_search_kind(),
        max_probes,
        |candidate| {
            flow_fits_at_size(
                pp,
                candidate,
                resolve_line_height_px(candidate),
                fb,
                region_provider,
                min_region_width_fixed,
                max_lines,
                wrap,
            )
        },
    )
}

// ---------------------------------------------------------------------------
// Vertical fit binary search helpers
// ---------------------------------------------------------------------------

fn flow_fits_at_size_vertical(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    column_width: f64,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_height_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<bool, BoundtextError> {
    let min_region_height = min_region_height_fixed.unwrap_or(font_size_px);
    measure_flow_vertical_with_budgeted_provider(
        pp,
        font_size_px,
        column_width,
        fb,
        region_provider,
        min_region_height,
        max_lines,
        wrap,
    )
    .map(|measure| measure.fits())
}

/// Select the largest vertical font size in the shrink interval that fits.
///
/// # Errors
///
/// Returns a typed budget, geometry-provider, or candidate-layout failure.
pub(super) fn flow_fit_shrink_vertical(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    min_size: f64,
    epsilon: f64,
    max_iter: usize,
    max_probes: Option<usize>,
    mut resolve_column_width_px: impl FnMut(f64) -> f64,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_height_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<(f64, Option<FlowOverflowReason>), BoundtextError> {
    fit_shrink_with(
        font_size_px,
        min_size,
        epsilon,
        max_iter,
        region_provider.fit_search_kind(),
        max_probes,
        |candidate| {
            flow_fits_at_size_vertical(
                pp,
                candidate,
                resolve_column_width_px(candidate),
                fb,
                region_provider,
                min_region_height_fixed,
                max_lines,
                wrap,
            )
        },
    )
}

/// Select the largest vertical font size in the grow interval that fits.
///
/// # Errors
///
/// Returns a typed budget, geometry-provider, or candidate-layout failure.
pub(super) fn flow_fit_grow_vertical(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    max_size: f64,
    epsilon: f64,
    max_iter: usize,
    max_probes: Option<usize>,
    mut resolve_column_width_px: impl FnMut(f64) -> f64,
    fb: &FlowBounds,
    region_provider: &impl RegionProvider,
    min_region_height_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> Result<(f64, Option<FlowOverflowReason>), BoundtextError> {
    fit_grow_with(
        font_size_px,
        max_size,
        epsilon,
        max_iter,
        region_provider.fit_search_kind(),
        max_probes,
        |candidate| {
            flow_fits_at_size_vertical(
                pp,
                candidate,
                resolve_column_width_px(candidate),
                fb,
                region_provider,
                min_region_height_fixed,
                max_lines,
                wrap,
            )
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uncertified_shrink_selects_largest_fitting_grid_candidate_without_monotonicity() {
        let (chosen, overflow) = fit_shrink_with(
            20.0,
            10.0,
            2.0,
            0,
            FitSearchKind::Uncertified,
            Some(6),
            |candidate| Ok(candidate == 18.0 || candidate == 12.0),
        )
        .expect("exact grid should fit within its probe budget");

        assert_eq!(chosen, 18.0);
        assert_eq!(overflow, None);
    }

    #[test]
    fn uncertified_search_rejects_the_complete_grid_before_any_probe() {
        let mut probe_count = 0;
        let error = fit_shrink_with(
            20.0,
            10.0,
            2.0,
            12,
            FitSearchKind::Uncertified,
            Some(5),
            |_| {
                probe_count += 1;
                Ok(true)
            },
        )
        .expect_err("six candidates cannot fit a five-probe budget");

        assert_eq!(
            error,
            BoundtextError::FitProbeLimit {
                required: 6,
                limit: 5,
            }
        );
        assert_eq!(probe_count, 0);
    }

    #[test]
    fn certified_search_keeps_iteration_and_probe_limits_independent() {
        let mut probe_count = 0;
        let (chosen, overflow) = fit_shrink_with(
            20.0,
            10.0,
            0.25,
            0,
            FitSearchKind::CertifiedMonotone,
            Some(0),
            |candidate| {
                probe_count += 1;
                Ok(candidate <= 15.0)
            },
        )
        .expect("the exact-grid budget does not govern certified binary search");

        assert_eq!(chosen, 10.0);
        assert_eq!(overflow, None);
        assert_eq!(probe_count, 2);
    }

    #[test]
    fn uncertified_search_rejects_a_non_positive_grid_step() {
        let error = fit_grow_with(
            10.0,
            20.0,
            0.0,
            12,
            FitSearchKind::Uncertified,
            None,
            |_| Ok(true),
        )
        .expect_err("an exact grid requires a positive step");

        assert_eq!(error, BoundtextError::InvalidFitStep);
    }
}
