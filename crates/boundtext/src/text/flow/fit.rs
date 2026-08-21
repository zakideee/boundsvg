use crate::text::paragraph;
use crate::text::types::WrapMode;

use super::{
    FlowBounds, FlowOverflowReason, FlowRegionSource, measure_flow, measure_flow_vertical,
};

// ---------------------------------------------------------------------------
// Fit binary search helpers
// ---------------------------------------------------------------------------

pub(crate) const DEFAULT_MIN_FONT_SIZE: f64 = 8.0;
pub(crate) const DEFAULT_FIT_EPSILON: f64 = 0.25;
pub(crate) const DEFAULT_FIT_MAX_ITERATIONS: usize = 12;
pub(crate) const DEFAULT_GROW_MULTIPLIER: f64 = 4.0;

pub(crate) fn fit_shrink_with(
    font_size_px: f64,
    min_size: f64,
    epsilon: f64,
    max_iter: usize,
    mut fits_at: impl FnMut(f64) -> bool,
) -> (f64, Option<FlowOverflowReason>) {
    let min_size = min_size.max(f64::EPSILON).min(font_size_px);
    if fits_at(font_size_px) {
        return (font_size_px, None);
    }
    if !fits_at(min_size) {
        return (min_size, Some(FlowOverflowReason::CannotFit));
    }

    let (mut lo, mut hi) = (min_size, font_size_px);
    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        if fits_at(mid) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo, None)
}

pub(crate) fn fit_grow_with(
    font_size_px: f64,
    max_size: f64,
    epsilon: f64,
    max_iter: usize,
    mut fits_at: impl FnMut(f64) -> bool,
) -> (f64, Option<FlowOverflowReason>) {
    let max_size = max_size.max(font_size_px);
    if !fits_at(font_size_px) {
        return (font_size_px, Some(FlowOverflowReason::CannotFit));
    }
    if fits_at(max_size) {
        return (max_size, None);
    }

    let (mut lo, mut hi) = (font_size_px, max_size);
    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        if fits_at(mid) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo, None)
}

/// Check whether all text is consumed at a given font size.
fn flow_fits_at_size(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    line_height_px: f64,
    fb: &FlowBounds,
    regions_source: &impl FlowRegionSource,
    min_region_width_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> bool {
    let min_region_width = min_region_width_fixed.unwrap_or(font_size_px);
    measure_flow(
        pp,
        font_size_px,
        line_height_px,
        fb,
        regions_source,
        min_region_width,
        max_lines,
        wrap,
    )
    .fits()
}

/// Binary search for the largest font size in `[min_size, font_size_px]` that
/// fits all text. Returns `(settled_size, overflow_reason_if_cannot_fit)`.
pub(super) fn flow_fit_shrink(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    min_size: f64,
    epsilon: f64,
    max_iter: usize,
    mut resolve_line_height_px: impl FnMut(f64) -> f64,
    fb: &FlowBounds,
    regions_source: &impl FlowRegionSource,
    min_region_width_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> (f64, Option<FlowOverflowReason>) {
    let min_size = min_size.max(f64::EPSILON).min(font_size_px);

    if flow_fits_at_size(
        pp,
        font_size_px,
        resolve_line_height_px(font_size_px),
        fb,
        regions_source,
        min_region_width_fixed,
        max_lines,
        wrap,
    ) {
        return (font_size_px, None);
    }
    if !flow_fits_at_size(
        pp,
        min_size,
        resolve_line_height_px(min_size),
        fb,
        regions_source,
        min_region_width_fixed,
        max_lines,
        wrap,
    ) {
        return (min_size, Some(FlowOverflowReason::CannotFit));
    }

    let (mut lo, mut hi) = (min_size, font_size_px);
    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        if flow_fits_at_size(
            pp,
            mid,
            resolve_line_height_px(mid),
            fb,
            regions_source,
            min_region_width_fixed,
            max_lines,
            wrap,
        ) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo, None)
}

/// Binary search for the largest font size in `[font_size_px, max_size]` that
/// fits all text.
pub(super) fn flow_fit_grow(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    max_size: f64,
    epsilon: f64,
    max_iter: usize,
    mut resolve_line_height_px: impl FnMut(f64) -> f64,
    fb: &FlowBounds,
    regions_source: &impl FlowRegionSource,
    min_region_width_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> (f64, Option<FlowOverflowReason>) {
    let max_size = max_size.max(font_size_px);

    if !flow_fits_at_size(
        pp,
        font_size_px,
        resolve_line_height_px(font_size_px),
        fb,
        regions_source,
        min_region_width_fixed,
        max_lines,
        wrap,
    ) {
        return (font_size_px, Some(FlowOverflowReason::CannotFit));
    }
    if flow_fits_at_size(
        pp,
        max_size,
        resolve_line_height_px(max_size),
        fb,
        regions_source,
        min_region_width_fixed,
        max_lines,
        wrap,
    ) {
        return (max_size, None);
    }

    let (mut lo, mut hi) = (font_size_px, max_size);
    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        if flow_fits_at_size(
            pp,
            mid,
            resolve_line_height_px(mid),
            fb,
            regions_source,
            min_region_width_fixed,
            max_lines,
            wrap,
        ) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo, None)
}

// ---------------------------------------------------------------------------
// Vertical fit binary search helpers
// ---------------------------------------------------------------------------

fn flow_fits_at_size_vertical(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    column_width: f64,
    fb: &FlowBounds,
    regions_source: &impl FlowRegionSource,
    min_region_height_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> bool {
    let min_region_height = min_region_height_fixed.unwrap_or(font_size_px);
    measure_flow_vertical(
        pp,
        font_size_px,
        column_width,
        fb,
        regions_source,
        min_region_height,
        max_lines,
        wrap,
    )
    .fits()
}

pub(super) fn flow_fit_shrink_vertical(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    min_size: f64,
    epsilon: f64,
    max_iter: usize,
    mut resolve_column_width_px: impl FnMut(f64) -> f64,
    fb: &FlowBounds,
    regions_source: &impl FlowRegionSource,
    min_region_height_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> (f64, Option<FlowOverflowReason>) {
    let min_size = min_size.max(f64::EPSILON).min(font_size_px);

    if flow_fits_at_size_vertical(
        pp,
        font_size_px,
        resolve_column_width_px(font_size_px),
        fb,
        regions_source,
        min_region_height_fixed,
        max_lines,
        wrap,
    ) {
        return (font_size_px, None);
    }
    if !flow_fits_at_size_vertical(
        pp,
        min_size,
        resolve_column_width_px(min_size),
        fb,
        regions_source,
        min_region_height_fixed,
        max_lines,
        wrap,
    ) {
        return (min_size, Some(FlowOverflowReason::CannotFit));
    }

    let (mut lo, mut hi) = (min_size, font_size_px);
    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        if flow_fits_at_size_vertical(
            pp,
            mid,
            resolve_column_width_px(mid),
            fb,
            regions_source,
            min_region_height_fixed,
            max_lines,
            wrap,
        ) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo, None)
}

pub(super) fn flow_fit_grow_vertical(
    pp: &paragraph::ShapedParagraph,
    font_size_px: f64,
    max_size: f64,
    epsilon: f64,
    max_iter: usize,
    mut resolve_column_width_px: impl FnMut(f64) -> f64,
    fb: &FlowBounds,
    regions_source: &impl FlowRegionSource,
    min_region_height_fixed: Option<f64>,
    max_lines: Option<usize>,
    wrap: WrapMode,
) -> (f64, Option<FlowOverflowReason>) {
    let max_size = max_size.max(font_size_px);

    if !flow_fits_at_size_vertical(
        pp,
        font_size_px,
        resolve_column_width_px(font_size_px),
        fb,
        regions_source,
        min_region_height_fixed,
        max_lines,
        wrap,
    ) {
        return (font_size_px, Some(FlowOverflowReason::CannotFit));
    }
    if flow_fits_at_size_vertical(
        pp,
        max_size,
        resolve_column_width_px(max_size),
        fb,
        regions_source,
        min_region_height_fixed,
        max_lines,
        wrap,
    ) {
        return (max_size, None);
    }

    let (mut lo, mut hi) = (font_size_px, max_size);
    for _ in 0..max_iter {
        if hi - lo < epsilon {
            break;
        }
        let mid = f64::midpoint(lo, hi);
        if flow_fits_at_size_vertical(
            pp,
            mid,
            resolve_column_width_px(mid),
            fb,
            regions_source,
            min_region_height_fixed,
            max_lines,
            wrap,
        ) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo, None)
}
