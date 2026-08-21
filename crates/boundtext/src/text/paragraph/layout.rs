use crate::text::grapheme::grapheme_split;
use crate::text::kinsoku::{
    add_bounded_intentional_overflow_px, apply_kinsoku, intentional_hanging_overflow_px,
    is_hanging_char, is_valid_break_boundary,
};
use crate::text::types::{Line, PositionedGlyph, WrapMode};

use super::super::engine::{BreakMeasure, BreakResult};
use super::{GlyphCharSpan, ShapedParagraph};

// ---------------------------------------------------------------------------
// Cursor-based sequential line layout
// ---------------------------------------------------------------------------

/// Cursor state for incremental line-by-line layout.
#[derive(Debug, Clone)]
pub struct BreakCursor {
    /// Index into the char array (from grapheme split): start of next unprocessed character.
    pub char_index: usize,
    /// Current line number (0-based).
    pub line_number: usize,
    /// A final hard break reserves one additional empty visual line.
    pub pending_empty_line: bool,
}

impl BreakCursor {
    /// Create a cursor starting at the beginning of the paragraph.
    #[must_use]
    pub fn new() -> Self {
        Self {
            char_index: 0,
            line_number: 0,
            pending_empty_line: false,
        }
    }

    /// Whether there is remaining text to lay out.
    #[must_use]
    pub fn has_remaining(&self, shaped: &ShapedParagraph) -> bool {
        let grapheme_count = shaped.char_byte_offsets.len().saturating_sub(1);
        self.char_index < grapheme_count || self.pending_empty_line
    }

    /// Whether there is remaining text given a grapheme count.
    ///
    /// Used by `ShapedInlineRuns` which tracks grapheme count independently.
    #[must_use]
    pub fn has_remaining_count(&self, grapheme_count: usize) -> bool {
        self.char_index < grapheme_count || self.pending_empty_line
    }
}

impl Default for BreakCursor {
    fn default() -> Self {
        Self::new()
    }
}

/// A single line produced by `layout_next_line`.
#[derive(Debug, Clone)]
pub struct LineRange {
    /// Character range [start, end) in the shaped paragraph.
    pub char_start: usize,
    pub char_end: usize,
    /// Computed line width in px.
    pub width: f64,
    /// Whether kinsoku backtracking failed for this line.
    pub kinsoku_unresolved: bool,
}

// ---------------------------------------------------------------------------
// Multi-region visual line layout
// ---------------------------------------------------------------------------

/// A text fragment placed within one free region of a visual line.
#[derive(Debug, Clone)]
pub struct LayoutLineFragment {
    /// Character range [start, end) in the shaped paragraph.
    pub char_start: usize,
    pub char_end: usize,
    /// Consumed inline advance in px (physical width for horizontal, physical height for vertical).
    pub inline_advance_px: f64,
    /// Index of the region this fragment occupies.
    pub region_index: usize,
    /// Intentional overflow metadata for this fragment.
    pub overflow_reason: Option<LayoutOverflowReason>,
    /// Maximum inline overflow attributable to the intentional tail.
    pub intentional_overflow_px: f64,
}

/// A complete visual line consisting of one or more fragments across regions.
#[derive(Debug, Clone)]
pub struct LayoutLine {
    pub fragments: Vec<LayoutLineFragment>,
}

/// Overflow reason at the fragment level within a visual line.
///
/// Each variant describes why a single fragment exceeded its region width.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutOverflowReason {
    /// Characters absorbed forward to satisfy Japanese typesetting rules
    /// (JIS X 4051 kinsoku shori), overflowing the region width.
    KinsokuAbsorb,
    /// A trailing punctuation mark intentionally hangs past the region edge.
    HangingPunctuation,
}

// ---------------------------------------------------------------------------
// Ellipsis truncation on ShapedParagraph
// ---------------------------------------------------------------------------

/// Result of finding an ellipsis truncation point within a layout fragment.
#[derive(Debug, Clone)]
pub struct EllipsisTruncation {
    /// Character index to truncate at (exclusive). Text `[char_start..truncate_at]`
    /// is the kept prefix.
    pub truncate_at: usize,
    /// Inline-direction extent of the kept prefix in px.
    /// For horizontal text this is the width; for vertical text this is the height.
    pub prefix_extent: f64,
}

// ---------------------------------------------------------------------------
// layout_paragraph — cheap relayout from font-unit data
// ---------------------------------------------------------------------------

/// Lay out a shaped paragraph at the given font size and max width.
///
/// Returns a `BreakResult` with full `Line` data (no `maxLines` truncation —
/// the caller is responsible for that).
pub fn layout_paragraph(
    shaped: &ShapedParagraph,
    font_size_px: f64,
    line_height_px: f64,
    baseline_offset_px: f64,
    max_width: f64,
    wrap: WrapMode,
    force_newline_breaks: bool,
) -> BreakResult {
    let text = &*shaped.text;
    if text.is_empty() {
        return BreakResult {
            lines: vec![Line {
                text: String::new(),
                glyphs: Vec::new(),
                width: 0.0,
                baseline_y: baseline_offset_px,
                fragments: None,
                positioned_glyphs: Some(Vec::new()),
            }],
            kinsoku_unresolved: false,
        };
    }

    let scale = font_size_px / f64::from(shaped.units_per_em);
    let advances_px = compute_advances_px(shaped, scale);
    let chars = grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(String::as_str).collect();

    // wrap=None and no forced newline breaks → single line
    if wrap == WrapMode::None && !force_newline_breaks {
        return build_single_line_result(shaped, scale, text, &advances_px, baseline_offset_px);
    }

    // --- Line-breaking loop ---
    let mut line_breaks: Vec<usize> = Vec::new();
    let mut line_start: usize = 0;
    let mut current_width: f64 = 0.0;
    let mut last_breakable: Option<usize> = None;
    let mut kinsoku_unresolved = false;

    for index in 0..chars_ref.len() {
        // PreWrap: `\n` forces a line break
        if force_newline_breaks && chars_ref[index] == "\n" {
            line_breaks.push(index + 1);
            line_start = index + 1;
            current_width = 0.0;
            last_breakable = None;
            continue;
        }

        let char_width = advances_px[index];

        last_breakable = find_breakable(
            wrap,
            index,
            line_start,
            shaped.uax14_break_flags.as_deref(),
            &chars_ref,
            last_breakable,
        );
        current_width += char_width;

        if current_width > max_width && index > line_start {
            // Check hanging punctuation
            if let Some(ch) = chars_ref[index].chars().next()
                && is_hanging_char(ch, shaped.hanging_chars)
            {
                continue;
            }

            let Some(mut break_pos) = break_position_or_force(
                wrap,
                last_breakable,
                line_start,
                index,
                shaped.kinsoku_profile.is_some(),
            ) else {
                continue;
            };

            if let Some(profile) = shaped.kinsoku_profile {
                break_pos = apply_kinsoku(&chars_ref, break_pos, line_start, profile);
                if break_pos <= line_start {
                    kinsoku_unresolved = true;
                    break_pos = crate::text::kinsoku::avoid_non_breaking_pair_split(
                        &chars_ref, index, line_start, profile,
                    );
                }
            }

            line_breaks.push(break_pos);
            line_start = break_pos;
            current_width = recalc_width(&advances_px, line_start, index);
            last_breakable = None;
        }
    }

    // --- Build lines ---
    let lines = build_lines_from_breaks(
        &line_breaks,
        &chars_ref,
        &advances_px,
        shaped,
        scale,
        text,
        line_height_px,
        baseline_offset_px,
    );

    BreakResult {
        lines,
        kinsoku_unresolved,
    }
}

// ---------------------------------------------------------------------------
// measure_paragraph — lightweight measurement only
// ---------------------------------------------------------------------------

/// A paragraph measurement together with its per-line break diagnostics.
pub struct ParagraphMeasure {
    pub measure: BreakMeasure,
    /// One entry per measured line, in order. Forced-newline separators are
    /// not part of any line's range (a one-grapheme gap between lines).
    pub lines: Vec<LineRange>,
}

/// Measure a shaped paragraph at the given font size and max width.
///
/// Returns line count, max line width, and kinsoku status without building
/// full `Line`/`PositionedGlyph` data.
#[must_use]
pub fn measure_paragraph(
    shaped: &ShapedParagraph,
    font_size_px: f64,
    line_height_px: f64,
    max_width: f64,
    wrap: WrapMode,
    force_newline_breaks: bool,
) -> BreakMeasure {
    measure_paragraph_with_lines(
        shaped,
        font_size_px,
        line_height_px,
        max_width,
        wrap,
        force_newline_breaks,
    )
    .measure
}

/// Like [`measure_paragraph`], additionally collecting a [`LineRange`] per
/// measured line (character range, inline advance, per-line kinsoku status).
#[must_use]
pub fn measure_paragraph_with_lines(
    shaped: &ShapedParagraph,
    font_size_px: f64,
    _line_height_px: f64,
    max_width: f64,
    wrap: WrapMode,
    force_newline_breaks: bool,
) -> ParagraphMeasure {
    measure_paragraph_with_lines_and_indent(
        shaped,
        font_size_px,
        max_width,
        wrap,
        force_newline_breaks,
        0.0,
    )
}

/// Like [`measure_paragraph_with_lines`], with a first-line inline-axis indent.
/// The indent participates in both wrapping and the reported first-line width.
#[must_use]
pub fn measure_paragraph_with_lines_and_indent(
    shaped: &ShapedParagraph,
    font_size_px: f64,
    max_width: f64,
    wrap: WrapMode,
    force_newline_breaks: bool,
    text_indent: f64,
) -> ParagraphMeasure {
    let text = &*shaped.text;
    if text.is_empty() {
        return ParagraphMeasure {
            measure: BreakMeasure {
                line_count: 1,
                max_line_width: 0.0,
                kinsoku_unresolved: false,
            },
            lines: vec![LineRange {
                char_start: 0,
                char_end: 0,
                width: 0.0,
                kinsoku_unresolved: false,
            }],
        };
    }

    let scale = font_size_px / f64::from(shaped.units_per_em);
    let advances_px = compute_advances_px(shaped, scale);
    let chars = grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(String::as_str).collect();

    // wrap=None and no forced newline breaks → single line
    if wrap == WrapMode::None && !force_newline_breaks {
        let total_width: f64 = advances_px.iter().sum::<f64>() + text_indent;
        return ParagraphMeasure {
            measure: BreakMeasure {
                line_count: 1,
                max_line_width: total_width,
                kinsoku_unresolved: false,
            },
            lines: vec![LineRange {
                char_start: 0,
                char_end: chars_ref.len(),
                width: total_width,
                kinsoku_unresolved: false,
            }],
        };
    }

    // Line-breaking loop (measure only)
    let mut lines: Vec<LineRange> = Vec::new();
    let mut max_line_width = 0.0;
    let mut line_start = 0usize;
    let mut current_width = text_indent;
    let mut last_breakable: Option<usize> = None;
    let mut kinsoku_unresolved = false;

    for index in 0..chars_ref.len() {
        // PreWrap: \n forces a line break
        if force_newline_breaks && chars_ref[index] == "\n" {
            let finished_width: f64 = advances_px[line_start..index].iter().sum::<f64>()
                + if line_start == 0 { text_indent } else { 0.0 };
            if finished_width > max_line_width {
                max_line_width = finished_width;
            }
            lines.push(LineRange {
                char_start: line_start,
                char_end: index,
                width: finished_width,
                kinsoku_unresolved: false,
            });
            line_start = index + 1;
            current_width = 0.0;
            last_breakable = None;
            continue;
        }

        let char_width = advances_px[index];
        last_breakable = find_breakable(
            wrap,
            index,
            line_start,
            shaped.uax14_break_flags.as_deref(),
            &chars_ref,
            last_breakable,
        );
        current_width += char_width;

        if current_width > max_width && index > line_start {
            if let Some(ch) = chars_ref[index].chars().next()
                && is_hanging_char(ch, shaped.hanging_chars)
            {
                continue;
            }

            let Some(mut break_pos) = break_position_or_force(
                wrap,
                last_breakable,
                line_start,
                index,
                shaped.kinsoku_profile.is_some(),
            ) else {
                continue;
            };

            let mut line_kinsoku_unresolved = false;
            if let Some(profile) = shaped.kinsoku_profile {
                break_pos = apply_kinsoku(&chars_ref, break_pos, line_start, profile);
                if break_pos <= line_start {
                    kinsoku_unresolved = true;
                    line_kinsoku_unresolved = true;
                    break_pos = crate::text::kinsoku::avoid_non_breaking_pair_split(
                        &chars_ref, index, line_start, profile,
                    );
                }
            }

            let finished_width: f64 = advances_px[line_start..break_pos].iter().sum::<f64>()
                + if line_start == 0 { text_indent } else { 0.0 };
            if finished_width > max_line_width {
                max_line_width = finished_width;
            }

            lines.push(LineRange {
                char_start: line_start,
                char_end: break_pos,
                width: finished_width,
                kinsoku_unresolved: line_kinsoku_unresolved,
            });
            line_start = break_pos;
            current_width = recalc_width(&advances_px, line_start, index);
            last_breakable = None;
        }
    }

    let final_width: f64 = advances_px[line_start..].iter().sum::<f64>()
        + if line_start == 0 { text_indent } else { 0.0 };
    if final_width > max_line_width {
        max_line_width = final_width;
    }
    lines.push(LineRange {
        char_start: line_start,
        char_end: chars_ref.len(),
        width: final_width,
        kinsoku_unresolved: false,
    });

    ParagraphMeasure {
        measure: BreakMeasure {
            line_count: lines.len(),
            max_line_width,
            kinsoku_unresolved,
        },
        lines,
    }
}

/// Lay out the next line from a shaped paragraph with the given width.
///
/// Advances the cursor past the consumed characters. Returns `None`
/// when all text has been consumed. Each call can specify a different
/// `max_width`, enabling variable-width-per-line layout (e.g., text
/// flowing around obstacles).
///
/// Break semantics match `layout_paragraph` and the existing engine path:
/// UAX#14 + kinsoku + hanging punctuation.
pub fn layout_next_line(
    shaped: &ShapedParagraph,
    cursor: &mut BreakCursor,
    font_size_px: f64,
    line_height_px: f64,
    max_width: f64,
    wrap: WrapMode,
) -> Option<LineRange> {
    let grapheme_count = shaped.char_byte_offsets.len().saturating_sub(1);
    layout_next_line_before(
        shaped,
        cursor,
        font_size_px,
        line_height_px,
        max_width,
        wrap,
        grapheme_count,
    )
}

fn layout_next_line_before(
    shaped: &ShapedParagraph,
    cursor: &mut BreakCursor,
    font_size_px: f64,
    _line_height_px: f64,
    max_width: f64,
    wrap: WrapMode,
    line_limit: usize,
) -> Option<LineRange> {
    if cursor.char_index >= line_limit {
        return None;
    }

    let text = &*shaped.text;
    let scale = font_size_px / f64::from(shaped.units_per_em);
    let advances_px = compute_advances_px(shaped, scale);
    let chars = grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(String::as_str).collect();

    let line_start = cursor.char_index;

    // wrap=None → consume all remaining text in one line
    if wrap == WrapMode::None {
        let width: f64 = advances_px[line_start..line_limit].iter().sum();
        let range = LineRange {
            char_start: line_start,
            char_end: line_limit,
            width,
            kinsoku_unresolved: false,
        };
        cursor.char_index = line_limit;
        cursor.line_number += 1;
        return Some(range);
    }

    // Single-line breaking loop from cursor position
    let mut current_width = 0.0;
    let mut last_breakable: Option<usize> = None;
    let mut kinsoku_unresolved = false;

    for index in line_start..line_limit {
        let char_width = advances_px[index];
        last_breakable = find_breakable(
            wrap,
            index,
            line_start,
            shaped.uax14_break_flags.as_deref(),
            &chars_ref,
            last_breakable,
        );
        current_width += char_width;

        if current_width > max_width && index > line_start {
            if let Some(ch) = chars_ref[index].chars().next()
                && is_hanging_char(ch, shaped.hanging_chars)
            {
                continue;
            }

            let Some(mut break_pos) = break_position_or_force(
                wrap,
                last_breakable,
                line_start,
                index,
                shaped.kinsoku_profile.is_some(),
            ) else {
                continue;
            };

            if let Some(profile) = shaped.kinsoku_profile {
                break_pos = apply_kinsoku(&chars_ref, break_pos, line_start, profile);
                if break_pos <= line_start {
                    kinsoku_unresolved = true;
                    break_pos = crate::text::kinsoku::avoid_non_breaking_pair_split(
                        &chars_ref, index, line_start, profile,
                    );
                }
            }

            let width: f64 = advances_px[line_start..break_pos].iter().sum();
            let range = LineRange {
                char_start: line_start,
                char_end: break_pos,
                width,
                kinsoku_unresolved,
            };
            cursor.char_index = break_pos;
            cursor.line_number += 1;
            return Some(range);
        }
    }

    // Remaining text fits on this line
    let width: f64 = advances_px[line_start..line_limit].iter().sum();
    let range = LineRange {
        char_start: line_start,
        char_end: line_limit,
        width,
        kinsoku_unresolved: false,
    };
    cursor.char_index = line_limit;
    cursor.line_number += 1;
    Some(range)
}

/// Lay out the next visual line across multiple free regions (hybrid model).
///
/// Non-last regions are filled using wrap-aware break opportunities only —
/// no kinsoku or hanging punctuation adjustment at region boundaries. The last
/// region uses the full `layout_next_line()` pipeline (UAX#14 + kinsoku +
/// hanging punctuation) so that the actual visual-line break respects Japanese
/// typesetting rules.
///
/// Returns `None` when all text has been consumed.
pub fn layout_next_flow_line(
    shaped: &ShapedParagraph,
    cursor: &mut BreakCursor,
    font_size_px: f64,
    line_height_px: f64,
    regions: &[(f64, f64)],
    wrap: WrapMode,
) -> Option<LayoutLine> {
    let grapheme_count = shaped.char_byte_offsets.len().saturating_sub(1);
    match early_flow_line_result(cursor, regions.is_empty(), grapheme_count) {
        EarlyFlowLine::Continue => {}
        EarlyFlowLine::Return(result) => return result,
    }

    let text = &*shaped.text;
    let scale = font_size_px / f64::from(shaped.units_per_em);
    let advances_px = compute_advances_px(shaped, scale);
    let chars = grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(String::as_str).collect();

    let saved_line_number = cursor.line_number;
    let forced_break_index = chars_ref[cursor.char_index..]
        .iter()
        .position(|grapheme| *grapheme == "\n")
        .map(|offset| cursor.char_index + offset);
    if forced_break_index == Some(cursor.char_index) {
        cursor.char_index += 1;
        cursor.pending_empty_line = cursor.char_index >= grapheme_count;
        cursor.line_number = saved_line_number + 1;
        return Some(LayoutLine {
            fragments: Vec::new(),
        });
    }
    let line_limit = forced_break_index.unwrap_or(grapheme_count);
    let mut fragments = Vec::new();
    let last_region = regions.len() - 1;

    // --- Non-last regions: wrap-aware fill (no kinsoku) ---
    for (region_idx, &(_x, width)) in regions[..last_region].iter().enumerate() {
        if cursor.char_index >= line_limit {
            break;
        }

        let frag_start = cursor.char_index;
        let mut frag_end = frag_start;
        let mut used = 0.0;
        let mut last_breakable = None;

        for index in frag_start..line_limit {
            let char_w = advances_px[index];
            last_breakable = find_breakable(
                wrap,
                index,
                frag_start,
                shaped.uax14_break_flags.as_deref(),
                &chars_ref,
                last_breakable,
            );

            if used + char_w > width {
                let break_pos = match wrap {
                    WrapMode::None => frag_start,
                    WrapMode::Char => index,
                    WrapMode::Word => last_breakable
                        .filter(|&pos| pos > frag_start)
                        .unwrap_or(frag_start),
                };

                if break_pos > frag_start {
                    frag_end = break_pos;
                    used = advances_px[frag_start..break_pos].iter().sum();
                } else {
                    // A word/nowrap run that has no legal boundary in this
                    // region must move intact to the next region.
                    frag_end = frag_start;
                    used = 0.0;
                }
                break;
            }

            used += char_w;
            frag_end = index + 1;
        }

        if frag_end > frag_start {
            cursor.char_index = frag_end;
            fragments.push(LayoutLineFragment {
                char_start: frag_start,
                char_end: frag_end,
                inline_advance_px: used,
                region_index: region_idx,
                overflow_reason: None,
                intentional_overflow_px: 0.0,
            });
        }
    }

    // --- Last region: full layout_next_line with kinsoku ---
    if cursor.char_index < line_limit {
        let &(_x, width) = &regions[last_region];

        let Some(range) = layout_next_line_before(
            shaped,
            cursor,
            font_size_px,
            line_height_px,
            width,
            wrap,
            line_limit,
        ) else {
            if fragments.is_empty() {
                cursor.line_number = saved_line_number;
                return None;
            }
            cursor.line_number = saved_line_number + 1;
            return Some(LayoutLine { fragments });
        };

        let mut frag_end = range.char_end;
        let mut frag_advance = range.width;
        let mut intentional_overflow_px = if wrap == WrapMode::None {
            0.0
        } else {
            intentional_hanging_overflow_px(
                range.char_start,
                range.char_end,
                &advances_px,
                width,
                &chars_ref,
                shaped.hanging_chars,
            )
        };
        let mut overflow_reason = if intentional_overflow_px > 0.0 {
            Some(LayoutOverflowReason::HangingPunctuation)
        } else {
            None
        };

        // When kinsoku couldn't resolve (narrow region), the break boundary
        // may violate head-prohibit, tail-prohibit, or non-breaking rules.
        // Absorb characters forward until the boundary is legal — overflowing
        // the region is preferable to violating kinsoku at a real line boundary.
        if let Some(profile) = shaped.kinsoku_profile {
            let original_end = frag_end;
            while frag_end < line_limit && !is_valid_break_boundary(&chars_ref, frag_end, profile) {
                frag_advance += advances_px[frag_end];
                intentional_overflow_px = add_bounded_intentional_overflow_px(
                    intentional_overflow_px,
                    advances_px[frag_end],
                    width,
                );
                frag_end += 1;
            }
            if frag_end > original_end {
                overflow_reason = Some(LayoutOverflowReason::KinsokuAbsorb);
            }
            cursor.char_index = frag_end;
        }

        fragments.push(LayoutLineFragment {
            char_start: range.char_start,
            char_end: frag_end,
            inline_advance_px: frag_advance,
            region_index: last_region,
            overflow_reason,
            intentional_overflow_px,
        });
    }

    finish_paragraph_flow_line(
        cursor,
        saved_line_number,
        forced_break_index,
        grapheme_count,
        fragments,
    )
}

fn take_pending_empty_flow_line(cursor: &mut BreakCursor) -> Option<LayoutLine> {
    if !cursor.pending_empty_line {
        return None;
    }
    cursor.pending_empty_line = false;
    cursor.line_number += 1;
    Some(LayoutLine {
        fragments: Vec::new(),
    })
}

enum EarlyFlowLine {
    Continue,
    Return(Option<LayoutLine>),
}

fn early_flow_line_result(
    cursor: &mut BreakCursor,
    regions_empty: bool,
    grapheme_count: usize,
) -> EarlyFlowLine {
    if regions_empty {
        return EarlyFlowLine::Return(None);
    }
    if cursor.char_index < grapheme_count {
        return EarlyFlowLine::Continue;
    }
    EarlyFlowLine::Return(take_pending_empty_flow_line(cursor))
}

fn finish_flow_cursor(
    cursor: &mut BreakCursor,
    saved_line_number: usize,
    forced_break_index: Option<usize>,
    grapheme_count: usize,
) {
    if forced_break_index == Some(cursor.char_index) {
        cursor.char_index += 1;
        cursor.pending_empty_line = cursor.char_index >= grapheme_count;
    }
    cursor.line_number = saved_line_number + 1;
}

fn finish_paragraph_flow_line(
    cursor: &mut BreakCursor,
    saved_line_number: usize,
    forced_break_index: Option<usize>,
    grapheme_count: usize,
    fragments: Vec<LayoutLineFragment>,
) -> Option<LayoutLine> {
    if fragments.is_empty() {
        cursor.line_number = saved_line_number;
        return None;
    }
    finish_flow_cursor(
        cursor,
        saved_line_number,
        forced_break_index,
        grapheme_count,
    );
    Some(LayoutLine { fragments })
}

// ---------------------------------------------------------------------------
// Helpers — advances computation
// ---------------------------------------------------------------------------

/// Compute per-character advances in px from font-unit data.
pub(crate) fn compute_advances_px(shaped: &ShapedParagraph, scale: f64) -> Vec<f64> {
    shaped
        .char_advances_funits
        .iter()
        .zip(&shaped.tracking_counts)
        .map(|(&funits, &tracking)| {
            funits as f64 * scale + f64::from(tracking) * shaped.letter_spacing_px
        })
        .collect()
}

/// Compute per-character vertical advances in px from glyph data.
///
/// Uses the orientation-normalized vertical inline advance when available,
/// with raw y/x metrics as a compatibility fallback. Includes letter spacing.
pub(crate) fn compute_vertical_advances_px(shaped: &ShapedParagraph, scale: f64) -> Vec<f64> {
    let char_count = shaped.char_byte_offsets.len().saturating_sub(1);
    let mut advances = vec![0.0_f64; char_count];

    let text = &*shaped.text;
    let chars = super::super::grapheme::grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(String::as_str).collect();
    let byte_to_char = super::super::engine::build_byte_to_char_map(&chars_ref);

    for glyph in &shaped.glyphs {
        let char_idx = byte_to_char
            .get(glyph.cluster as usize)
            .copied()
            .unwrap_or(0);
        if char_idx < char_count {
            let y_advance = i64::from(glyph.y_advance_funits).abs();
            let advance_funits = glyph.vertical_inline_advance_funits.unwrap_or_else(|| {
                if y_advance > 0 {
                    y_advance
                } else {
                    i64::from(glyph.x_advance_funits).abs()
                }
            });
            let advance = advance_funits as f64 * scale;
            advances[char_idx] += advance;
        }
    }

    // Add letter-spacing tracking
    for (index, &tracking) in shaped.tracking_counts.iter().enumerate() {
        if index < char_count {
            advances[index] += f64::from(tracking) * shaped.letter_spacing_px;
        }
    }

    advances
}

/// Lay out the next visual column across multiple free regions (vertical mode).
///
/// Mirrors `layout_next_flow_line` but uses vertical advances: characters
/// flow top-to-bottom, and regions are `(y, height)` instead of `(x, width)`.
pub fn layout_next_flow_column(
    shaped: &ShapedParagraph,
    cursor: &mut BreakCursor,
    font_size_px: f64,
    _column_width: f64,
    regions: &[(f64, f64)],
    wrap: WrapMode,
) -> Option<LayoutLine> {
    let grapheme_count = shaped.char_byte_offsets.len().saturating_sub(1);
    match early_flow_line_result(cursor, regions.is_empty(), grapheme_count) {
        EarlyFlowLine::Continue => {}
        EarlyFlowLine::Return(result) => return result,
    }

    let text = &*shaped.text;
    let scale = font_size_px / f64::from(shaped.units_per_em);
    let advances_px = compute_vertical_advances_px(shaped, scale);
    let chars = super::super::grapheme::grapheme_split(text);
    let chars_ref: Vec<&str> = chars.iter().map(String::as_str).collect();

    let saved_line_number = cursor.line_number;
    let forced_break_index = chars_ref[cursor.char_index..]
        .iter()
        .position(|grapheme| *grapheme == "\n")
        .map(|offset| cursor.char_index + offset);
    if forced_break_index == Some(cursor.char_index) {
        cursor.char_index += 1;
        cursor.pending_empty_line = cursor.char_index >= grapheme_count;
        cursor.line_number = saved_line_number + 1;
        return Some(LayoutLine {
            fragments: Vec::new(),
        });
    }
    let column_limit = forced_break_index.unwrap_or(grapheme_count);
    let mut fragments = Vec::new();
    let last_region = regions.len() - 1;

    // --- Non-last regions: wrap-aware fill (no kinsoku) ---
    for (region_idx, &(_y, height)) in regions[..last_region].iter().enumerate() {
        if cursor.char_index >= column_limit {
            break;
        }

        let frag_start = cursor.char_index;
        let mut frag_end = frag_start;
        let mut used = 0.0;
        let mut last_breakable = None;

        for index in frag_start..column_limit {
            let char_h = advances_px[index];
            last_breakable = find_breakable(
                wrap,
                index,
                frag_start,
                shaped.uax14_break_flags.as_deref(),
                &chars_ref,
                last_breakable,
            );

            if used + char_h > height {
                let break_pos = match wrap {
                    WrapMode::None => frag_start,
                    WrapMode::Char => index,
                    WrapMode::Word => last_breakable
                        .filter(|&pos| pos > frag_start)
                        .unwrap_or(frag_start),
                };

                if break_pos > frag_start {
                    frag_end = break_pos;
                    used = advances_px[frag_start..break_pos].iter().sum();
                } else {
                    // A word/nowrap run that has no legal boundary in this
                    // region must move intact to the next region.
                    frag_end = frag_start;
                    used = 0.0;
                }
                break;
            }

            used += char_h;
            frag_end = index + 1;
        }

        if frag_end > frag_start {
            cursor.char_index = frag_end;
            fragments.push(LayoutLineFragment {
                char_start: frag_start,
                char_end: frag_end,
                inline_advance_px: used,
                region_index: region_idx,
                overflow_reason: None,
                intentional_overflow_px: 0.0,
            });
        }
    }

    // --- Last region: full kinsoku ---
    if cursor.char_index < column_limit {
        let &(_y, height) = &regions[last_region];
        let line_start = cursor.char_index;
        let mut frag_end = line_start;
        let mut used = 0.0;
        let mut last_breakable = None;

        for index in line_start..column_limit {
            last_breakable = find_breakable(
                wrap,
                index,
                line_start,
                shaped.uax14_break_flags.as_deref(),
                &chars_ref,
                last_breakable,
            );

            if used + advances_px[index] > height {
                if index == line_start {
                    used += advances_px[index];
                    frag_end = index + 1;
                    continue;
                }
                if chars_ref[index]
                    .chars()
                    .next()
                    .is_some_and(|character| is_hanging_char(character, shaped.hanging_chars))
                {
                    used += advances_px[index];
                    frag_end = index + 1;
                    continue;
                }
                let break_pos = match wrap {
                    WrapMode::None => {
                        frag_end = column_limit;
                        used = advances_px[line_start..column_limit].iter().sum();
                        break;
                    }
                    WrapMode::Char => last_breakable
                        .filter(|&position| position > line_start)
                        .unwrap_or(index),
                    WrapMode::Word => match last_breakable.filter(|&pos| pos > line_start) {
                        Some(pos) => pos,
                        // Kinsoku needs a forced candidate for apply_kinsoku below;
                        // otherwise keep the unbreakable token intact and overflow.
                        None if shaped.kinsoku_profile.is_some() => index,
                        None => {
                            used += advances_px[index];
                            frag_end = index + 1;
                            continue;
                        }
                    },
                };

                let final_pos = if let Some(profile) = shaped.kinsoku_profile {
                    let adjusted = super::super::kinsoku::apply_kinsoku(
                        &chars_ref, break_pos, line_start, profile,
                    );
                    if adjusted <= line_start {
                        break_pos
                    } else {
                        adjusted
                    }
                } else {
                    break_pos
                };

                frag_end = final_pos;
                used = advances_px[line_start..final_pos].iter().sum();
                break;
            }

            used += advances_px[index];
            frag_end = index + 1;
        }

        if frag_end <= line_start && !fragments.is_empty() {
            cursor.line_number = saved_line_number + 1;
            return Some(LayoutLine { fragments });
        }
        if frag_end <= line_start {
            cursor.line_number = saved_line_number;
            return None;
        }

        // Kinsoku forward absorption
        let mut intentional_overflow_px = if wrap == WrapMode::None {
            0.0
        } else {
            intentional_hanging_overflow_px(
                line_start,
                frag_end,
                &advances_px,
                height,
                &chars_ref,
                shaped.hanging_chars,
            )
        };
        let mut overflow_reason = if intentional_overflow_px > 0.0 {
            Some(LayoutOverflowReason::HangingPunctuation)
        } else {
            None
        };
        if let Some(profile) = shaped.kinsoku_profile {
            let original_end = frag_end;
            while frag_end < column_limit
                && !super::super::kinsoku::is_valid_break_boundary(&chars_ref, frag_end, profile)
            {
                used += advances_px[frag_end];
                intentional_overflow_px = add_bounded_intentional_overflow_px(
                    intentional_overflow_px,
                    advances_px[frag_end],
                    height,
                );
                frag_end += 1;
            }
            if frag_end > original_end {
                overflow_reason = Some(LayoutOverflowReason::KinsokuAbsorb);
            }
        }

        cursor.char_index = frag_end;
        fragments.push(LayoutLineFragment {
            char_start: line_start,
            char_end: frag_end,
            inline_advance_px: used,
            region_index: last_region,
            overflow_reason,
            intentional_overflow_px,
        });
    }

    finish_paragraph_flow_line(
        cursor,
        saved_line_number,
        forced_break_index,
        grapheme_count,
        fragments,
    )
}

// ---------------------------------------------------------------------------
// Helpers — line breaking
// ---------------------------------------------------------------------------

/// Find the most recent breakable position at or before `index`.
pub(crate) fn find_breakable(
    wrap: WrapMode,
    index: usize,
    line_start: usize,
    uax14_break_set: Option<&[bool]>,
    chars: &[&str],
    last_breakable: Option<usize>,
) -> Option<usize> {
    if index <= line_start {
        return last_breakable;
    }

    if let Some(break_set) = uax14_break_set {
        if index < break_set.len() && break_set[index] {
            return Some(index);
        }
        return last_breakable;
    }

    if wrap == WrapMode::Char {
        return Some(index);
    }
    // wrap == Word
    if index > 0 && is_word_break(chars, index - 1) {
        return Some(index);
    }
    last_breakable
}

/// Build a single-line result for wrap=None.
fn build_single_line_result(
    shaped: &ShapedParagraph,
    scale: f64,
    text: &str,
    advances_px: &[f64],
    baseline_offset_px: f64,
) -> BreakResult {
    let total_width: f64 = advances_px.iter().sum();
    let glyphs = build_scaled_glyph_infos(shaped, scale);
    let char_count = shaped.char_advances_funits.len();
    let positioned = build_shaped_positioned_glyphs(
        &(0..shaped.glyphs.len()).collect::<Vec<_>>(),
        shaped,
        scale,
        text,
        0,
        char_count,
        baseline_offset_px,
    );
    BreakResult {
        lines: vec![Line {
            text: text.to_string(),
            glyphs,
            width: total_width,
            baseline_y: baseline_offset_px,
            fragments: None,
            positioned_glyphs: Some(positioned),
        }],
        kinsoku_unresolved: false,
    }
}

fn is_cjk_ideograph(cp: u32) -> bool {
    (0x4E00..=0x9FFF).contains(&cp) || (0xF900..=0xFAFF).contains(&cp)
}

fn is_hiragana(cp: u32) -> bool {
    (0x3040..=0x309F).contains(&cp)
}

fn is_katakana(cp: u32) -> bool {
    (0x30A0..=0x30FF).contains(&cp)
}

fn is_cjk(cp: u32) -> bool {
    is_cjk_ideograph(cp) || is_hiragana(cp) || is_katakana(cp)
}

fn is_ascii_whitespace(cp: u32) -> bool {
    cp == 0x0020 || cp == 0x0009
}

fn is_hyphen(cp: u32) -> bool {
    cp == 0x002D || cp == 0x2010
}

/// Determine if a line break is allowed between chars[index] and chars[index+1].
fn is_word_break(chars: &[&str], index: usize) -> bool {
    if index >= chars.len().saturating_sub(1) {
        return false;
    }

    let current_cp = match chars[index].chars().next() {
        Some(ch) => ch as u32,
        None => return false,
    };
    let next_cp = match chars[index + 1].chars().next() {
        Some(ch) => ch as u32,
        None => return false,
    };

    if is_ascii_whitespace(current_cp) {
        return true;
    }
    if is_cjk(current_cp) || is_cjk(next_cp) {
        return true;
    }
    if is_hyphen(current_cp) {
        return true;
    }

    false
}

fn recalc_width(advances: &[f64], line_start: usize, current_idx: usize) -> f64 {
    let mut width = 0.0;
    for index in line_start..=current_idx {
        width += advances.get(index).copied().unwrap_or(0.0);
    }
    width
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

// ---------------------------------------------------------------------------
// Helpers — GlyphInfo/PositionedGlyph construction from ShapedGlyph
// ---------------------------------------------------------------------------

/// Scale all shaped glyphs to `GlyphInfo` at the given scale factor.
fn build_scaled_glyph_infos(
    shaped: &ShapedParagraph,
    scale: f64,
) -> Vec<crate::font::shaping::GlyphInfo> {
    shaped
        .glyphs
        .iter()
        .enumerate()
        .map(|(index, glyph)| {
            let tracking_adjust = tracking_after_glyph(shaped, index);
            crate::font::shaping::GlyphInfo {
                glyph_id: glyph.glyph_id,
                x_advance: f64::from(glyph.x_advance_funits) * scale + tracking_adjust,
                y_advance: f64::from(glyph.y_advance_funits) * scale,
                x_offset: f64::from(glyph.x_offset_funits) * scale,
                y_offset: f64::from(glyph.y_offset_funits) * scale,
                cluster: glyph.cluster,
                font_alias: Some(glyph.font_alias.clone()),
                font_weight: Some(glyph.font_weight),
                font_style: Some(glyph.font_style.clone()),
                rotation_deg: Some(0),
            }
        })
        .collect()
}

/// Build positioned glyphs for a line slice from shaped data.
fn build_shaped_positioned_glyphs(
    glyph_indices: &[usize],
    shaped: &ShapedParagraph,
    scale: f64,
    text: &str,
    line_start_char: usize,
    line_end_char: usize,
    baseline_y: f64,
) -> Vec<PositionedGlyph> {
    let mut cursor_x = 0.0;
    let mut positioned = Vec::with_capacity(glyph_indices.len());

    for &glyph_index in glyph_indices {
        let Some(glyph) = shaped.glyphs.get(glyph_index) else {
            continue;
        };
        let span = shaped
            .glyph_char_spans
            .get(glyph_index)
            .cloned()
            .unwrap_or(GlyphCharSpan {
                start: line_start_char,
                end: (line_start_char + 1).min(line_end_char),
            });
        let span_start = span.start.max(line_start_char).min(line_end_char);
        let span_end = span.end.max(span_start + 1).min(line_end_char);

        let start_byte = shaped
            .char_byte_offsets
            .get(span_start)
            .copied()
            .unwrap_or(0) as usize;
        #[expect(
            clippy::cast_possible_truncation,
            reason = "text length is well within u32::MAX for any realistic text"
        )]
        let text_len_u32 = text.len() as u32;
        let end_byte = shaped
            .char_byte_offsets
            .get(span_end)
            .copied()
            .unwrap_or(text_len_u32) as usize;

        let glyph_text = text.get(start_byte..end_byte).unwrap_or("").to_string();
        let tracking_adjust = tracking_after_glyph(shaped, glyph_index);
        let x_advance = f64::from(glyph.x_advance_funits) * scale + tracking_adjust;
        let y_advance = f64::from(glyph.y_advance_funits) * scale;
        let x_offset = f64::from(glyph.x_offset_funits) * scale;
        let y_offset = f64::from(glyph.y_offset_funits) * scale;

        #[expect(
            clippy::cast_possible_truncation,
            reason = "byte offsets within text strings; text length is well within u32::MAX"
        )]
        let positioned_glyph = PositionedGlyph {
            glyph_id: glyph.glyph_id,
            text: glyph_text,
            cluster_start: start_byte as u32,
            cluster_end: end_byte as u32,
            source_start: Some(span_start as u32),
            source_end: Some(span_end as u32),
            source_role: Some("content".to_string()),
            decoration_source_start: Some(span_start as u32),
            decoration_source_end: Some(span_end as u32),
            decoration_level: None,
            path_decoration_owner_id: None,
            path_distance_start_px: None,
            path_distance_end_px: None,
            text_decoration_geometry: None,
            font_alias: glyph.font_alias.clone(),
            font_fallback: Vec::new(),
            font_weight: glyph.font_weight,
            font_style: glyph.font_style.clone(),
            font_size_px: None,
            font_variation_settings: None,
            font_feature_settings: None,
            fill: None,
            text_strokes: None,
            text_shadows: None,
            paint_range_index: None,
            origin_x: cursor_x + x_offset,
            origin_y: baseline_y + y_offset,
            x_offset,
            y_offset,
            x_advance,
            y_advance,
            rotation_deg: 0,
            baseline_rotation_deg: None,
            inline_scale: None,
            synthetic_kind: None,
            outline_writing_mode: None,
            absolute_position: None,
        };
        positioned.push(positioned_glyph);
        cursor_x += x_advance;
    }

    positioned
}

// ---------------------------------------------------------------------------
// Helpers — line building from break positions
// ---------------------------------------------------------------------------

fn build_lines_from_breaks(
    line_breaks: &[usize],
    chars: &[&str],
    advances_px: &[f64],
    shaped: &ShapedParagraph,
    scale: f64,
    text: &str,
    line_height_px: f64,
    baseline_offset_px: f64,
) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut start = 0usize;

    let mut all_breaks: Vec<usize> = line_breaks.to_vec();
    all_breaks.push(chars.len());

    for (line_index, &end) in all_breaks.iter().enumerate() {
        // Strip trailing \n from line text (PreWrap break boundary only)
        let text_end = if end > start && chars.get(end - 1) == Some(&"\n") {
            end - 1
        } else {
            end
        };
        let line_text: String = chars[start..text_end].join("");
        let mut line_width = 0.0;
        let mut line_glyph_indices = Vec::new();

        for (advance, range) in advances_px[start..end]
            .iter()
            .zip(&shaped.glyph_ranges[start..end])
        {
            line_width += advance;
            for glyph_index in range.start..range.end {
                if line_glyph_indices.last().copied() != Some(glyph_index) {
                    line_glyph_indices.push(glyph_index);
                }
            }
        }

        // Build GlyphInfo for the line (scaled from ShapedGlyph)
        let line_glyphs: Vec<crate::font::shaping::GlyphInfo> = line_glyph_indices
            .iter()
            .filter_map(|&glyph_index| {
                let glyph = shaped.glyphs.get(glyph_index)?;
                let tracking_adjust = tracking_after_glyph(shaped, glyph_index);
                Some(crate::font::shaping::GlyphInfo {
                    glyph_id: glyph.glyph_id,
                    x_advance: f64::from(glyph.x_advance_funits) * scale + tracking_adjust,
                    y_advance: f64::from(glyph.y_advance_funits) * scale,
                    x_offset: f64::from(glyph.x_offset_funits) * scale,
                    y_offset: f64::from(glyph.y_offset_funits) * scale,
                    cluster: glyph.cluster,
                    font_alias: Some(glyph.font_alias.clone()),
                    font_weight: Some(glyph.font_weight),
                    font_style: Some(glyph.font_style.clone()),
                    rotation_deg: Some(0),
                })
            })
            .collect();

        let baseline_y = baseline_offset_px + line_index as f64 * line_height_px;
        let positioned_glyphs = build_shaped_positioned_glyphs(
            &line_glyph_indices,
            shaped,
            scale,
            text,
            start,
            end,
            baseline_y,
        );

        lines.push(Line {
            text: line_text,
            glyphs: line_glyphs,
            width: line_width,
            baseline_y,
            fragments: None,
            positioned_glyphs: Some(positioned_glyphs),
        });

        start = end;
    }

    lines
}

fn tracking_after_glyph(shaped: &ShapedParagraph, glyph_index: usize) -> f64 {
    let Some(glyph) = shaped.glyphs.get(glyph_index) else {
        return 0.0;
    };
    if shaped.letter_spacing_px != 0.0
        && shaped
            .glyphs
            .get(glyph_index + 1)
            .is_some_and(|next| next.cluster != glyph.cluster)
    {
        shaped.letter_spacing_px
    } else {
        0.0
    }
}

#[cfg(test)]
mod tracking_tests {
    use super::*;
    use crate::font::FontStyle;
    use crate::text::paragraph::{GlyphCharSpan, GlyphRange, ShapedGlyph};
    use std::sync::Arc;

    fn multi_glyph_cluster_paragraph() -> ShapedParagraph {
        let glyph = |glyph_id, cluster, x_advance_funits| ShapedGlyph {
            glyph_id,
            x_advance_funits,
            y_advance_funits: 0,
            vertical_inline_advance_funits: None,
            x_offset_funits: 0,
            y_offset_funits: 0,
            cluster,
            font_alias: "test".to_string(),
            font_weight: 400,
            font_style: FontStyle::Normal,
        };
        ShapedParagraph {
            text: Arc::from("A\u{fe0f}B"),
            glyphs: vec![glyph(1, 0, 500), glyph(2, 0, 0), glyph(3, 4, 500)],
            units_per_em: 1000,
            char_advances_funits: vec![500, 500],
            tracking_counts: vec![1, 0],
            char_byte_offsets: vec![0, 4, 5],
            glyph_ranges: vec![
                GlyphRange { start: 0, end: 2 },
                GlyphRange { start: 2, end: 3 },
            ],
            glyph_char_spans: vec![
                GlyphCharSpan { start: 0, end: 1 },
                GlyphCharSpan { start: 0, end: 1 },
                GlyphCharSpan { start: 1, end: 2 },
            ],
            uax14_break_flags: None,
            kinsoku_profile: None,
            hanging_chars: None,
            letter_spacing_px: 2.0,
            font_variation_settings: Vec::new(),
            font_feature_settings: Vec::new(),
        }
    }

    #[test]
    fn scaled_glyphs_add_tracking_only_at_cluster_boundaries() {
        let shaped = multi_glyph_cluster_paragraph();
        let glyphs = build_scaled_glyph_infos(&shaped, 0.01);

        assert_eq!(glyphs[0].x_advance, 5.0);
        assert_eq!(glyphs[1].x_advance, 2.0);
        assert_eq!(glyphs[2].x_advance, 5.0);
    }

    #[test]
    fn positioned_glyphs_keep_same_cluster_range_and_tracking() {
        let shaped = multi_glyph_cluster_paragraph();
        let positioned =
            build_shaped_positioned_glyphs(&[0, 1, 2], &shaped, 0.01, &shaped.text, 0, 2, 10.0);
        let first_cluster_end = 1_u32;

        assert_eq!(positioned[0].text, "A\u{fe0f}");
        assert_eq!(positioned[1].text, "A\u{fe0f}");
        assert_eq!(positioned[0].cluster_start, 0);
        assert_eq!(positioned[0].cluster_end, 4);
        assert_eq!(positioned[1].cluster_start, 0);
        assert_eq!(positioned[1].cluster_end, 4);
        assert_eq!(positioned[0].source_start, Some(0));
        assert_eq!(positioned[0].source_end, Some(first_cluster_end));
        assert_eq!(positioned[1].source_start, Some(0));
        assert_eq!(positioned[1].source_end, Some(first_cluster_end));
        assert_eq!(positioned[2].source_start, Some(first_cluster_end));
        assert_eq!(positioned[2].source_end, Some(first_cluster_end + 1));
        assert!(
            positioned
                .iter()
                .all(|glyph| glyph.source_role.as_deref() == Some("content"))
        );
        assert_eq!(positioned[0].x_advance, 5.0);
        assert_eq!(positioned[1].x_advance, 2.0);
        assert_eq!(positioned[2].x_advance, 5.0);
    }
}
