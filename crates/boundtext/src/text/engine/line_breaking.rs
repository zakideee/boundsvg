use super::break_detection::{build_uax14_break_set, find_breakable};
use super::char_mapping::build_byte_to_char_map;
use super::result_building::{build_horizontal_positioned_glyphs, build_lines_from_breaks};
use crate::font::shaping::GlyphInfo;
use crate::text::grapheme::grapheme_split;
use crate::text::kinsoku::{apply_kinsoku, is_hanging_char};
use crate::text::types::{Line, WrapMode};

use super::char_mapping::{CharGlyphMap, build_char_to_glyph_map};

// ---------------------------------------------------------------------------
// Line breaking
// ---------------------------------------------------------------------------

pub struct BreakResult {
    pub lines: Vec<Line>,
    pub kinsoku_unresolved: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct BreakLineRange {
    pub char_start: usize,
    pub char_end: usize,
    pub kinsoku_unresolved: bool,
}

pub(crate) struct BreakResultWithRanges {
    pub result: BreakResult,
    pub line_ranges: Vec<BreakLineRange>,
}

/// Lightweight measurement result for fit binary search.
/// Avoids building full `Vec<Line>` / `PositionedGlyph` data.
pub struct BreakMeasure {
    pub line_count: usize,
    pub max_line_width: f64,
    #[allow(dead_code)] // reported in the final layout step, not during measure
    pub kinsoku_unresolved: bool,
}

impl BreakMeasure {
    /// Check if the measured layout fits within the given constraints.
    #[must_use]
    pub fn fits(
        &self,
        max_width: f64,
        max_lines: Option<usize>,
        max_height: Option<f64>,
        line_height_px: f64,
    ) -> bool {
        if self.max_line_width > max_width {
            return false;
        }
        if let Some(max) = max_lines {
            if self.line_count > max {
                return false;
            }
        }
        if let Some(max_h) = max_height {
            let total_height = self.line_count as f64 * line_height_px;
            if total_height > max_h {
                return false;
            }
        }
        true
    }
}

/// Measure-only line breaking for fit binary search.
/// Returns line count, max line width, and kinsoku status without
/// building full Line/PositionedGlyph data.
pub(crate) fn measure_break_fit(
    glyphs: &[GlyphInfo],
    text: &str,
    max_width: f64,
    wrap: WrapMode,
    kinsoku: Option<&crate::text::kinsoku::KinsokuProfile>,
    uax14_breaks: Option<&[usize]>,
    hanging_chars: Option<&[char]>,
) -> BreakMeasure {
    if text.is_empty() {
        return BreakMeasure {
            line_count: 1,
            max_line_width: 0.0,
            kinsoku_unresolved: false,
        };
    }

    let chars = grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(std::string::String::as_str).collect();

    // Build only advances (skip glyph_ranges, glyph_spans, char_byte_offsets)
    let advances = build_advances_only(&chars_ref, glyphs);

    // wrap=None — single line, no breaking
    if wrap == WrapMode::None {
        let total_width: f64 = advances.iter().sum();
        return BreakMeasure {
            line_count: 1,
            max_line_width: total_width,
            kinsoku_unresolved: false,
        };
    }

    // Build UAX#14 break set
    let uax14_break_set = build_uax14_break_set(&chars_ref, uax14_breaks, text);

    // Line-breaking loop (measure only)
    let mut line_count: usize = 1;
    let mut max_line_width: f64 = 0.0;
    let mut line_start: usize = 0;
    let mut current_width: f64 = 0.0;
    let mut last_breakable: Option<usize> = None;
    let mut kinsoku_unresolved = false;

    for i in 0..chars_ref.len() {
        let char_width = advances[i];

        last_breakable = find_breakable(
            wrap,
            i,
            line_start,
            uax14_break_set.as_deref(),
            &chars_ref,
            last_breakable,
        );
        current_width += char_width;

        if current_width > max_width && i > line_start {
            // Check hanging punctuation
            if let Some(ch) = chars_ref[i].chars().next() {
                if is_hanging_char(ch, hanging_chars) {
                    continue;
                }
            }

            let Some(mut break_pos) =
                break_position_or_force(wrap, last_breakable, line_start, i, kinsoku.is_some())
            else {
                continue;
            };

            if let Some(profile) = kinsoku {
                break_pos = apply_kinsoku(&chars_ref, break_pos, line_start, profile);
                if break_pos <= line_start {
                    kinsoku_unresolved = true;
                    break_pos = crate::text::kinsoku::avoid_non_breaking_pair_split(
                        &chars_ref, i, line_start, profile,
                    );
                }
            }

            // Compute finished line width
            let finished_width: f64 = advances[line_start..break_pos].iter().sum();
            if finished_width > max_line_width {
                max_line_width = finished_width;
            }

            line_count += 1;
            line_start = break_pos;
            current_width = recalc_width(&advances, line_start, i);
            last_breakable = None;
        }
    }

    // Final line width
    let final_width: f64 = advances[line_start..].iter().sum();
    if final_width > max_line_width {
        max_line_width = final_width;
    }

    BreakMeasure {
        line_count,
        max_line_width,
        kinsoku_unresolved,
    }
}

/// Build only advances mapping (no `glyph_ranges/glyph_spans/char_byte_offsets`).
/// Used by `measure_break_fit` to avoid unnecessary allocations.
fn build_advances_only(chars: &[&str], glyphs: &[GlyphInfo]) -> Vec<f64> {
    let char_count = chars.len();
    let mut advances: Vec<f64> = vec![0.0; char_count];

    let byte_to_char_idx = build_byte_to_char_map(chars);

    for glyph in glyphs {
        let char_idx = byte_to_char_idx
            .get(glyph.cluster as usize)
            .copied()
            .unwrap_or(0);
        if char_idx < char_count {
            advances[char_idx] += glyph.x_advance;
        }
    }

    advances
}

/// Break shaped text into lines.
/// Also accessible to `fit.rs` via `break_lines_internal`.
// line breaking requires glyph data, text, width constraint, wrap mode, kinsoku, and line config
#[expect(
    clippy::too_many_arguments,
    reason = "text layout pipeline passes font context and layout constraints through stages"
)]
pub(crate) fn break_lines_internal(
    glyphs: &[GlyphInfo],
    text: &str,
    max_width: f64,
    wrap: WrapMode,
    kinsoku: Option<&crate::text::kinsoku::KinsokuProfile>,
    line_height_px: f64,
    baseline_offset_px: f64,
    uax14_breaks: Option<&[usize]>,
    hanging_chars: Option<&[char]>,
) -> BreakResult {
    break_lines_internal_with_options(
        glyphs,
        text,
        max_width,
        wrap,
        kinsoku,
        line_height_px,
        baseline_offset_px,
        uax14_breaks,
        hanging_chars,
        false,
        0.0,
    )
    .result
}

#[expect(
    clippy::too_many_arguments,
    reason = "text layout pipeline passes font context and layout constraints through stages"
)]
pub(crate) fn break_lines_internal_with_options(
    glyphs: &[GlyphInfo],
    text: &str,
    max_width: f64,
    wrap: WrapMode,
    kinsoku: Option<&crate::text::kinsoku::KinsokuProfile>,
    line_height_px: f64,
    baseline_offset_px: f64,
    uax14_breaks: Option<&[usize]>,
    hanging_chars: Option<&[char]>,
    force_newline_breaks: bool,
    text_indent: f64,
) -> BreakResultWithRanges {
    if text.is_empty() {
        return BreakResultWithRanges {
            result: BreakResult {
                lines: vec![Line {
                    text: String::new(),
                    glyphs: Vec::new(),
                    width: 0.0,
                    baseline_y: baseline_offset_px,
                    fragments: None,
                    positioned_glyphs: Some(Vec::new()),
                }],
                kinsoku_unresolved: false,
            },
            line_ranges: vec![BreakLineRange {
                char_start: 0,
                char_end: 0,
                kinsoku_unresolved: false,
            }],
        };
    }

    let chars = grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(std::string::String::as_str).collect();
    let CharGlyphMap {
        advances,
        glyph_ranges,
        glyph_spans,
        char_byte_offsets,
    } = build_char_to_glyph_map(&chars_ref, glyphs, text);

    // wrap=None — single line, no breaking
    if wrap == WrapMode::None && !force_newline_breaks {
        let total_width: f64 = advances.iter().sum::<f64>() + text_indent;
        let mut positioned_glyphs = build_horizontal_positioned_glyphs(
            glyphs,
            &glyph_spans,
            text,
            &char_byte_offsets,
            baseline_offset_px,
        );
        shift_positioned_glyphs_x(&mut positioned_glyphs, text_indent);
        return BreakResultWithRanges {
            result: BreakResult {
                lines: vec![Line {
                    text: text.to_string(),
                    glyphs: glyphs.to_vec(),
                    width: total_width,
                    baseline_y: baseline_offset_px,
                    fragments: None,
                    positioned_glyphs: Some(positioned_glyphs),
                }],
                kinsoku_unresolved: false,
            },
            line_ranges: vec![BreakLineRange {
                char_start: 0,
                char_end: chars_ref.len(),
                kinsoku_unresolved: false,
            }],
        };
    }

    // Build UAX#14 break set
    let uax14_break_set = build_uax14_break_set(&chars_ref, uax14_breaks, text);

    // Line-breaking loop
    let mut line_ranges: Vec<BreakLineRange> = Vec::new();
    let mut line_start: usize = 0;
    let mut current_width: f64 = text_indent;
    let mut last_breakable: Option<usize> = None;
    let mut kinsoku_unresolved = false;

    for i in 0..chars_ref.len() {
        if force_newline_breaks && chars_ref[i] == "\n" {
            line_ranges.push(BreakLineRange {
                char_start: line_start,
                char_end: i,
                kinsoku_unresolved: false,
            });
            line_start = i + 1;
            current_width = 0.0;
            last_breakable = None;
            continue;
        }

        if wrap == WrapMode::None {
            continue;
        }

        let char_width = advances[i];

        last_breakable = find_breakable(
            wrap,
            i,
            line_start,
            uax14_break_set.as_deref(),
            &chars_ref,
            last_breakable,
        );
        current_width += char_width;

        if current_width > max_width && i > line_start {
            // Check hanging punctuation
            if let Some(ch) = chars_ref[i].chars().next() {
                if is_hanging_char(ch, hanging_chars) {
                    continue;
                }
            }

            let Some(mut break_pos) =
                break_position_or_force(wrap, last_breakable, line_start, i, kinsoku.is_some())
            else {
                continue;
            };

            let mut line_kinsoku_unresolved = false;
            if let Some(profile) = kinsoku {
                break_pos = apply_kinsoku(&chars_ref, break_pos, line_start, profile);
                if break_pos <= line_start {
                    kinsoku_unresolved = true;
                    line_kinsoku_unresolved = true;
                    break_pos = crate::text::kinsoku::avoid_non_breaking_pair_split(
                        &chars_ref, i, line_start, profile,
                    );
                }
            }

            line_ranges.push(BreakLineRange {
                char_start: line_start,
                char_end: break_pos,
                kinsoku_unresolved: line_kinsoku_unresolved,
            });
            line_start = break_pos;
            current_width = recalc_width(&advances, line_start, i);
            last_breakable = None;
        }
    }

    line_ranges.push(BreakLineRange {
        char_start: line_start,
        char_end: chars_ref.len(),
        kinsoku_unresolved: false,
    });

    let lines = build_lines_from_breaks(
        &line_ranges,
        &chars_ref,
        &advances,
        &glyph_ranges,
        &glyph_spans,
        &char_byte_offsets,
        glyphs,
        text,
        line_height_px,
        baseline_offset_px,
        text_indent,
    );

    BreakResultWithRanges {
        result: BreakResult {
            lines,
            kinsoku_unresolved,
        },
        line_ranges,
    }
}

fn shift_positioned_glyphs_x(glyphs: &mut [crate::text::types::PositionedGlyph], shift: f64) {
    for glyph in glyphs {
        glyph.translate(shift, 0.0);
    }
}

// ---------------------------------------------------------------------------
// Line building
// ---------------------------------------------------------------------------

fn recalc_width(advances: &[f64], line_start: usize, current_idx: usize) -> f64 {
    let mut w = 0.0;
    for j in line_start..=current_idx {
        w += advances.get(j).copied().unwrap_or(0.0);
    }
    w
}

fn break_position_or_force(
    wrap: WrapMode,
    last_breakable: Option<usize>,
    line_start: usize,
    current_index: usize,
    kinsoku_active: bool,
) -> Option<usize> {
    if let Some(break_pos) = last_breakable.filter(|&break_pos| break_pos > line_start) {
        return Some(break_pos);
    }

    // Char wrap force-breaks at the grapheme boundary. Kinsoku needs a forced
    // candidate even without a breakable point so apply_kinsoku can shift it or
    // report kinsoku_unresolved; Word wrap keeps unbreakable tokens intact.
    if wrap == WrapMode::Char || kinsoku_active {
        return Some(current_index);
    }

    None
}
