use super::super::paragraph::EllipsisTruncation;
use super::types::ShapedInlineRuns;

/// Find the best ellipsis truncation point within inline runs.
///
/// Operates on `ShapedInlineRuns.grapheme_advances_px` directly (no
/// font-unit scaling needed). Validates break boundaries via
/// `is_valid_ellipsis_boundary` (tail-prohibit only).
pub fn find_ellipsis_truncation_point_inline(
    shaped: &ShapedInlineRuns,
    char_start: usize,
    char_end: usize,
    max_width: f64,
    ellipsis_width: f64,
) -> Option<EllipsisTruncation> {
    use super::super::kinsoku::is_valid_ellipsis_boundary;

    if ellipsis_width > max_width {
        return None;
    }

    let available = max_width - ellipsis_width;
    let advances = &shaped.grapheme_advances_px;

    // Binary search for largest k where prefix fits
    let mut lo = char_start;
    let mut hi = char_end;

    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        let prefix_width: f64 = advances[char_start..mid].iter().sum();
        if prefix_width <= available {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }

    // Validate ellipsis boundary (tail-prohibit only)
    let mut truncate_at = if let Some(profile) = shaped.kinsoku_profile {
        let chars_ref: Vec<&str> = shaped.graphemes.iter().map(String::as_str).collect();
        let mut pos = lo;
        while pos > char_start && !is_valid_ellipsis_boundary(&chars_ref, pos, profile) {
            pos -= 1;
        }
        pos
    } else {
        lo
    };

    // Never truncate inside a non-breakable range (ruby token interior).
    // If truncate_at falls inside a ruby token, retreat to the token start.
    while truncate_at > char_start
        && truncate_at < shaped.non_breakable.len()
        && shaped.non_breakable[truncate_at]
    {
        truncate_at -= 1;
    }

    let prefix_extent: f64 = advances[char_start..truncate_at].iter().sum();

    Some(EllipsisTruncation {
        truncate_at,
        prefix_extent,
    })
}
