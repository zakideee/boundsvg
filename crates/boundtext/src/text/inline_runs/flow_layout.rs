use super::super::paragraph::{BreakCursor, LayoutLine, LayoutLineFragment};
use super::super::types::WrapMode;
use super::types::ShapedInlineRuns;

/// Lay out the next visual column across multiple free y-regions using inline runs.
///
/// Thin wrapper over `layout_next_flow_line_inline`: the algorithm is
/// axis-agnostic — it fills regions with text using `grapheme_advances_px`.
/// When `ShapedInlineRuns` was built with `vertical=true`, the advances
/// are vertical (`y_advance`) so the regions represent `(y, height)` pairs.
pub fn layout_next_flow_column_inline(
    shaped: &ShapedInlineRuns,
    cursor: &mut BreakCursor,
    regions: &[(f64, f64)],
    wrap: WrapMode,
) -> Option<LayoutLine> {
    layout_next_flow_line_inline(shaped, cursor, regions, wrap)
}

pub fn layout_next_flow_column_inline_with_forced_newlines(
    shaped: &ShapedInlineRuns,
    cursor: &mut BreakCursor,
    regions: &[(f64, f64)],
    wrap: WrapMode,
) -> Option<LayoutLine> {
    layout_next_flow_line_inline_with_forced_newlines(shaped, cursor, regions, wrap)
}

/// Lay out the next visual line across multiple free regions using inline runs.
///
/// Mirrors `layout_next_flow_line` in `paragraph.rs` but operates on
/// `ShapedInlineRuns` (px-scale advances) instead of `ShapedParagraph`.
pub fn layout_next_flow_line_inline(
    shaped: &ShapedInlineRuns,
    cursor: &mut BreakCursor,
    regions: &[(f64, f64)],
    wrap: WrapMode,
) -> Option<LayoutLine> {
    layout_next_flow_line_inline_impl(shaped, cursor, regions, wrap, false)
}

pub fn layout_next_flow_line_inline_with_forced_newlines(
    shaped: &ShapedInlineRuns,
    cursor: &mut BreakCursor,
    regions: &[(f64, f64)],
    wrap: WrapMode,
) -> Option<LayoutLine> {
    layout_next_flow_line_inline_impl(shaped, cursor, regions, wrap, true)
}

fn layout_next_flow_line_inline_impl(
    shaped: &ShapedInlineRuns,
    cursor: &mut BreakCursor,
    regions: &[(f64, f64)],
    wrap: WrapMode,
    force_newline_breaks: bool,
) -> Option<LayoutLine> {
    use super::super::kinsoku::{
        add_bounded_intentional_overflow_px, apply_kinsoku, intentional_hanging_overflow_px,
        is_hanging_char, is_valid_break_boundary,
    };
    use super::super::paragraph::{LayoutOverflowReason, find_breakable};

    let grapheme_count = shaped.graphemes.len();
    match early_flow_line_result(cursor, regions.is_empty(), grapheme_count) {
        EarlyFlowLine::Continue => {}
        EarlyFlowLine::Return(result) => return result,
    }

    let chars_ref: Vec<&str> = shaped.graphemes.iter().map(String::as_str).collect();
    let advances = &shaped.grapheme_advances_px;
    let saved_line_number = cursor.line_number;
    let forced_break_index =
        find_forced_break_index(force_newline_breaks, &chars_ref, cursor.char_index);
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

    // Helper: find_breakable but reject non-breakable positions (ruby interior)
    let find_breakable_checked =
        |wrap, i, frag_start, uax14: Option<&[bool]>, chars: &[&str], prev| {
            let candidate = find_breakable(wrap, i, frag_start, uax14, chars, prev);
            // Reject positions flagged as non-breakable (inside ruby tokens)
            match candidate {
                Some(pos) if pos < shaped.non_breakable.len() && shaped.non_breakable[pos] => prev,
                _ => candidate,
            }
        };

    // --- Non-last regions: wrap-aware fill (no kinsoku) ---
    for (region_idx, &(_x, width)) in regions[..last_region].iter().enumerate() {
        if cursor.char_index >= line_limit {
            break;
        }

        let frag_start = cursor.char_index;
        let mut frag_end = frag_start;
        let mut used = 0.0;
        let mut last_breakable = None;

        for i in frag_start..line_limit {
            last_breakable = find_breakable_checked(
                wrap,
                i,
                frag_start,
                shaped.uax14_break_flags.as_deref(),
                &chars_ref,
                last_breakable,
            );

            if used + advances[i] > width {
                let mut break_pos = match wrap {
                    WrapMode::None => frag_start,
                    WrapMode::Char => i,
                    WrapMode::Word => last_breakable
                        .filter(|&bp| bp > frag_start)
                        .unwrap_or(frag_start),
                };
                // Retreat to the start of an atomic ruby range while keeping
                // any legal non-ruby prefix in the current region.
                while break_pos > frag_start
                    && break_pos < shaped.non_breakable.len()
                    && shaped.non_breakable[break_pos]
                {
                    break_pos -= 1;
                }

                if break_pos > frag_start {
                    frag_end = break_pos;
                    used = advances[frag_start..break_pos].iter().sum();
                } else {
                    // A word/nowrap/atomic run with no legal boundary here
                    // moves intact to the next region.
                    frag_end = frag_start;
                    used = 0.0;
                }
                break;
            }

            used += advances[i];
            frag_end = i + 1;
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

    // --- Last region: full line breaking with kinsoku ---
    if cursor.char_index < line_limit {
        let &(_x, width) = &regions[last_region];
        let line_start = cursor.char_index;
        let mut frag_end = line_start;
        let mut used = 0.0;
        let mut last_breakable = None;

        for i in line_start..line_limit {
            last_breakable = find_breakable_checked(
                wrap,
                i,
                line_start,
                shaped.uax14_break_flags.as_deref(),
                &chars_ref,
                last_breakable,
            );

            used += advances[i];
            frag_end = i + 1;
            if used > width && i > line_start {
                if wrap == WrapMode::None {
                    frag_end = line_limit;
                    used = advances[line_start..line_limit].iter().sum();
                    break;
                }
                if let Some(character) = chars_ref[i].chars().next()
                    && is_hanging_char(character, shaped.hanging_chars)
                {
                    continue;
                }
                let Some(mut break_pos) = last_breakable
                    .filter(|&candidate| candidate > line_start)
                    .or_else(|| {
                        (wrap == WrapMode::Char || shaped.kinsoku_profile.is_some()).then_some(i)
                    })
                else {
                    continue;
                };

                // Non-breakable guard: if the break_pos falls inside a
                // non-breakable range (ruby token), absorb forward until
                // the end of the non-breakable range.
                while break_pos < grapheme_count
                    && break_pos < shaped.non_breakable.len()
                    && shaped.non_breakable[break_pos]
                {
                    break_pos += 1;
                }

                // Apply kinsoku if available, but never retreat into a
                // non-breakable range (ruby token interior).
                let final_pos = if let Some(profile) = shaped.kinsoku_profile {
                    let adjusted = apply_kinsoku(&chars_ref, break_pos, line_start, profile);
                    if adjusted <= line_start {
                        break_pos
                    } else if adjusted < shaped.non_breakable.len()
                        && shaped.non_breakable[adjusted]
                    {
                        // kinsoku retreated into a ruby token — reject
                        break_pos
                    } else {
                        adjusted
                    }
                } else {
                    break_pos
                };

                frag_end = final_pos;
                used = advances[line_start..final_pos].iter().sum();
                break;
            }
        }

        if frag_end <= line_start && !fragments.is_empty() {
            cursor.line_number = saved_line_number + 1;
            return Some(LayoutLine { fragments });
        }

        if frag_end <= line_start {
            cursor.line_number = saved_line_number;
            return None;
        }

        // Kinsoku forward absorption on the last region
        let mut intentional_overflow_px = if wrap == WrapMode::None {
            0.0
        } else {
            intentional_hanging_overflow_px(
                line_start,
                frag_end,
                advances,
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
        if let Some(profile) = shaped.kinsoku_profile {
            let original_end = frag_end;
            while frag_end < line_limit
                && (!is_valid_break_boundary(&chars_ref, frag_end, profile)
                    || shaped.non_breakable.get(frag_end).copied().unwrap_or(false))
            {
                used += advances[frag_end];
                intentional_overflow_px = add_bounded_intentional_overflow_px(
                    intentional_overflow_px,
                    advances[frag_end],
                    width,
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

    finish_flow_line(
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

fn find_forced_break_index(
    force_newline_breaks: bool,
    graphemes: &[&str],
    char_index: usize,
) -> Option<usize> {
    if !force_newline_breaks {
        return None;
    }
    graphemes[char_index..]
        .iter()
        .position(|grapheme| *grapheme == "\n")
        .map(|offset| char_index + offset)
}

fn finish_flow_line(
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
    if forced_break_index == Some(cursor.char_index) {
        cursor.char_index += 1;
        cursor.pending_empty_line = cursor.char_index >= grapheme_count;
    }
    cursor.line_number = saved_line_number + 1;
    Some(LayoutLine { fragments })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::inline_runs::types::ShapedInlineRuns;
    use crate::text::kinsoku::get_kinsoku_profile;

    fn ruby_after_opening_bracket() -> ShapedInlineRuns {
        ShapedInlineRuns {
            text: "「注音符い".to_string(),
            grapheme_advances_px: vec![10.0; 5],
            segments: Vec::new(),
            graphemes: vec!["「", "注", "音", "符", "い"]
                .into_iter()
                .map(String::from)
                .collect(),
            char_byte_offsets: vec![0, 3, 6, 9, 12, 15],
            uax14_break_flags: None,
            kinsoku_profile: get_kinsoku_profile(Some("ja")),
            hanging_chars: None,
            // The ruby base covers [1, 4), so only its interior boundaries
            // at 2 and 3 are locked.
            non_breakable: vec![false, false, true, true, false],
            ruby_annotations: Vec::new(),
            notdef_infos: Vec::new(),
        }
    }

    #[test]
    fn kinsoku_absorption_does_not_stop_inside_ruby() {
        let shaped = ruby_after_opening_bracket();
        let mut cursor = BreakCursor::default();

        let line =
            layout_next_flow_line_inline(&shaped, &mut cursor, &[(0.0, 10.0)], WrapMode::Char)
                .expect("flow line");

        assert_eq!(line.fragments.len(), 1);
        let fragment = &line.fragments[0];
        assert_eq!(fragment.char_start, 0);
        assert_eq!(fragment.char_end, 4);
        assert_eq!(fragment.inline_advance_px, 40.0);
        assert_eq!(fragment.intentional_overflow_px, 10.0);
        assert!(
            fragment.inline_advance_px > 10.0 + fragment.intentional_overflow_px,
            "an atomic ruby wider than two regions must remain uncontained"
        );
        assert_eq!(
            fragment.overflow_reason,
            Some(crate::text::paragraph::LayoutOverflowReason::KinsokuAbsorb)
        );
    }

    #[test]
    fn vertical_wrapper_preserves_ruby_during_kinsoku_absorption() {
        let shaped = ruby_after_opening_bracket();
        let mut cursor = BreakCursor::default();

        let column =
            layout_next_flow_column_inline(&shaped, &mut cursor, &[(0.0, 10.0)], WrapMode::Char)
                .expect("flow column");

        assert_eq!(column.fragments[0].char_end, 4);
    }

    #[test]
    fn kinsoku_allowance_does_not_hide_preexisting_overflow() {
        let mut shaped = ruby_after_opening_bracket();
        shaped.grapheme_advances_px[0] = 20.0;
        let mut cursor = BreakCursor::default();

        let line =
            layout_next_flow_line_inline(&shaped, &mut cursor, &[(0.0, 10.0)], WrapMode::Char)
                .expect("flow line");
        let fragment = &line.fragments[0];

        assert_eq!(fragment.inline_advance_px, 50.0);
        assert_eq!(fragment.intentional_overflow_px, 10.0);
        assert!(
            fragment.inline_advance_px > 10.0 + fragment.intentional_overflow_px,
            "the oversized first token must remain outside the intentional allowance"
        );
    }

    #[test]
    fn hanging_punctuation_overflow_is_identified() {
        let shaped = ShapedInlineRuns {
            text: "ああ。い".to_string(),
            grapheme_advances_px: vec![10.0; 4],
            segments: Vec::new(),
            graphemes: vec!["あ", "あ", "。", "い"]
                .into_iter()
                .map(String::from)
                .collect(),
            char_byte_offsets: vec![0, 3, 6, 9, 12],
            uax14_break_flags: None,
            kinsoku_profile: None,
            hanging_chars: crate::text::kinsoku::get_hanging_chars(true),
            non_breakable: vec![false; 4],
            ruby_annotations: Vec::new(),
            notdef_infos: Vec::new(),
        };
        let mut cursor = BreakCursor::default();

        let line =
            layout_next_flow_line_inline(&shaped, &mut cursor, &[(0.0, 20.0)], WrapMode::Char)
                .expect("flow line");

        assert_eq!(line.fragments[0].char_end, 3);
        assert_eq!(line.fragments[0].inline_advance_px, 30.0);
        assert_eq!(line.fragments[0].intentional_overflow_px, 10.0);
        assert_eq!(
            line.fragments[0].overflow_reason,
            Some(crate::text::paragraph::LayoutOverflowReason::HangingPunctuation)
        );
    }

    #[test]
    fn consecutive_hanging_punctuation_uses_one_capacity_bounded_allowance() {
        let shaped = ShapedInlineRuns {
            text: "ああ」。い".to_string(),
            grapheme_advances_px: vec![10.0; 5],
            segments: Vec::new(),
            graphemes: vec!["あ", "あ", "」", "。", "い"]
                .into_iter()
                .map(String::from)
                .collect(),
            char_byte_offsets: vec![0, 3, 6, 9, 12, 15],
            uax14_break_flags: None,
            kinsoku_profile: None,
            hanging_chars: crate::text::kinsoku::get_hanging_chars(true),
            non_breakable: vec![false; 5],
            ruby_annotations: Vec::new(),
            notdef_infos: Vec::new(),
        };
        let mut cursor = BreakCursor::default();

        let line =
            layout_next_flow_line_inline(&shaped, &mut cursor, &[(0.0, 20.0)], WrapMode::Char)
                .expect("flow line");
        let fragment = &line.fragments[0];

        assert_eq!(fragment.char_end, 4);
        assert_eq!(fragment.inline_advance_px, 40.0);
        assert_eq!(fragment.intentional_overflow_px, 20.0);
        assert_eq!(
            fragment.overflow_reason,
            Some(crate::text::paragraph::LayoutOverflowReason::HangingPunctuation)
        );
    }

    #[test]
    fn pathological_hanging_tail_remains_uncontained() {
        let shaped = ShapedInlineRuns {
            text: "ああ」。、、、い".to_string(),
            grapheme_advances_px: vec![10.0; 8],
            segments: Vec::new(),
            graphemes: vec!["あ", "あ", "」", "。", "、", "、", "、", "い"]
                .into_iter()
                .map(String::from)
                .collect(),
            char_byte_offsets: vec![0, 3, 6, 9, 12, 15, 18, 21, 24],
            uax14_break_flags: None,
            kinsoku_profile: None,
            hanging_chars: crate::text::kinsoku::get_hanging_chars(true),
            non_breakable: vec![false; 8],
            ruby_annotations: Vec::new(),
            notdef_infos: Vec::new(),
        };
        let mut cursor = BreakCursor::default();

        let line =
            layout_next_flow_line_inline(&shaped, &mut cursor, &[(0.0, 20.0)], WrapMode::Char)
                .expect("flow line");
        let fragment = &line.fragments[0];

        assert_eq!(fragment.char_end, 7);
        assert_eq!(fragment.inline_advance_px, 70.0);
        assert_eq!(fragment.intentional_overflow_px, 0.0);
        assert!(
            fragment.inline_advance_px > 20.0 + fragment.intentional_overflow_px,
            "a punctuation tail longer than one region must not receive an unbounded exemption"
        );
    }
}
