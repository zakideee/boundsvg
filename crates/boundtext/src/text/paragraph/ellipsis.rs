use crate::text::grapheme::grapheme_split;
use crate::text::kinsoku::is_valid_ellipsis_boundary;

use super::{
    EllipsisTruncation, ShapedParagraph, compute_advances_px, compute_vertical_advances_px,
};

/// Find the best truncation point for ellipsis within a layout fragment.
///
/// Binary-searches the char range `[char_start, char_end)` to find the widest
/// prefix where `prefix_width + ellipsis_width <= max_width`. When a kinsoku
/// profile is active, the result is validated via `is_valid_ellipsis_boundary`
/// (tail-prohibit only — head-prohibit on the hidden suffix is irrelevant).
///
/// Returns `None` if even the ellipsis character alone exceeds `max_width`.
#[must_use]
pub fn find_ellipsis_truncation_point(
    shaped: &ShapedParagraph,
    font_size_px: f64,
    char_start: usize,
    char_end: usize,
    max_width: f64,
    ellipsis_width: f64,
) -> Option<EllipsisTruncation> {
    if ellipsis_width > max_width {
        return None;
    }

    let available = max_width - ellipsis_width;
    let scale = font_size_px / f64::from(shaped.units_per_em);
    let advances_px = compute_advances_px(shaped, scale);

    // Binary search: find the largest k in [char_start, char_end] where
    // sum(advances_px[char_start..k]) <= available.
    let mut lo = char_start;
    let mut hi = char_end;

    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2); // upper-mid bias
        let prefix_width: f64 = advances_px[char_start..mid].iter().sum();
        if prefix_width <= available {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    // lo = largest char count where prefix fits.

    // Validate ellipsis boundary: scan backward from lo to avoid ending the
    // visible prefix with a tail-prohibit character (e.g. "（", "「").
    // Unlike line-break validation, head-prohibit on the hidden suffix is
    // irrelevant — the suffix is replaced by "…", not moved to a new line.
    let truncate_at = if let Some(profile) = shaped.kinsoku_profile {
        let chars = grapheme_split(&shaped.text);
        let chars_ref: Vec<&str> = chars.iter().map(String::as_str).collect();
        let mut pos = lo;
        while pos > char_start && !is_valid_ellipsis_boundary(&chars_ref, pos, profile) {
            pos -= 1;
        }
        pos
    } else {
        lo
    };

    let prefix_extent: f64 = advances_px[char_start..truncate_at].iter().sum();
    Some(EllipsisTruncation {
        truncate_at,
        prefix_extent,
    })
}

/// Vertical variant of `find_ellipsis_truncation_point`.
///
/// Uses vertical advances (`y_advance` with `x_advance` fallback) instead of
/// horizontal advances.
#[must_use]
pub fn find_ellipsis_truncation_point_vertical(
    shaped: &ShapedParagraph,
    font_size_px: f64,
    char_start: usize,
    char_end: usize,
    max_height: f64,
    ellipsis_height: f64,
) -> Option<EllipsisTruncation> {
    if ellipsis_height > max_height {
        return None;
    }

    let available = max_height - ellipsis_height;
    let scale = font_size_px / f64::from(shaped.units_per_em);
    let advances_px = compute_vertical_advances_px(shaped, scale);

    let mut lo = char_start;
    let mut hi = char_end;
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        let prefix_height: f64 = advances_px[char_start..mid].iter().sum();
        if prefix_height <= available {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }

    let truncate_at = if let Some(profile) = shaped.kinsoku_profile {
        let chars = grapheme_split(&shaped.text);
        let chars_ref: Vec<&str> = chars.iter().map(String::as_str).collect();
        let mut pos = lo;
        while pos > char_start && !is_valid_ellipsis_boundary(&chars_ref, pos, profile) {
            pos -= 1;
        }
        pos
    } else {
        lo
    };

    let prefix_extent: f64 = advances_px[char_start..truncate_at].iter().sum();
    Some(EllipsisTruncation {
        truncate_at,
        prefix_extent,
    })
}
