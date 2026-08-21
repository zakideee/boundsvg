use crate::text::kinsoku::{KinsokuProfile, apply_kinsoku};

// ---------------------------------------------------------------------------
// UAX#14 break set (vertical)
// ---------------------------------------------------------------------------

pub(super) fn build_uax14_break_set_vertical(
    chars: &[&str],
    uax14_breaks: Option<&[usize]>,
    text: &str,
) -> Option<Vec<bool>> {
    let breaks: Vec<usize> = match uax14_breaks {
        Some(b) if !b.is_empty() => b.to_vec(),
        _ => crate::text::linebreak::uax14_break_opportunities(text),
    };
    if breaks.is_empty() {
        return None;
    }
    let uax14_breaks = &breaks;

    // Build byte offset -> char index mapping
    let mut byte_to_char: Vec<Option<usize>> = Vec::new();
    let mut byte_offset = 0;
    for (i, ch) in chars.iter().enumerate() {
        while byte_to_char.len() < byte_offset {
            byte_to_char.push(None);
        }
        byte_to_char.push(Some(i));
        byte_offset += ch.len();
        while byte_to_char.len() < byte_offset {
            byte_to_char.push(None);
        }
    }
    while byte_to_char.len() <= byte_offset {
        byte_to_char.push(Some(chars.len()));
    }

    let mut break_flags = vec![false; chars.len()];
    for &offset in uax14_breaks {
        if offset < byte_to_char.len() {
            if let Some(char_idx) = byte_to_char[offset] {
                if char_idx > 0 && char_idx < chars.len() {
                    break_flags[char_idx] = true;
                }
            }
        }
    }

    if break_flags.iter().any(|&b| b) {
        Some(break_flags)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Vertical break finding
// ---------------------------------------------------------------------------

pub(super) struct FindBreaksResult {
    pub(super) column_breaks: Vec<usize>,
    pub(super) kinsoku_unresolved: bool,
}

#[expect(
    clippy::cast_possible_wrap,
    reason = "column_start is a character index well within isize::MAX on any target"
)]
#[expect(
    clippy::cast_sign_loss,
    reason = "last_breakable is only used as usize when it exceeds column_start (positive)"
)]
fn resolve_break_pos(
    chars: &[&str],
    last_breakable: isize,
    column_start: usize,
    current_idx: usize,
    kinsoku: Option<&KinsokuProfile>,
) -> (usize, bool) {
    let mut break_pos = if last_breakable > column_start as isize {
        last_breakable as usize
    } else {
        current_idx
    };

    if let Some(profile) = kinsoku {
        break_pos = apply_kinsoku(chars, break_pos, column_start, profile);
        if break_pos <= column_start {
            return (
                crate::text::kinsoku::avoid_non_breaking_pair_split(
                    chars,
                    current_idx,
                    column_start,
                    profile,
                ),
                true,
            );
        }
    }

    (break_pos, false)
}

#[expect(
    clippy::cast_possible_wrap,
    reason = "character indices are well within isize::MAX on any target"
)]
pub(super) fn find_vertical_breaks(
    chars: &[&str],
    advances: &[f64],
    max_heights: &[f64],
    uax14_break_set: Option<&[bool]>,
    kinsoku: Option<&KinsokuProfile>,
    hanging_chars: Option<&[char]>,
    force_newline_breaks: bool,
) -> FindBreaksResult {
    debug_assert!(!max_heights.is_empty(), "max_heights must not be empty");

    let mut column_breaks: Vec<usize> = Vec::new();
    let mut column_start: usize = 0;
    let mut current_height: f64 = 0.0;
    let mut last_breakable: isize = -1;
    let mut kinsoku_unresolved = false;
    let mut column_index = 0usize;

    for i in 0..chars.len() {
        if force_newline_breaks && chars[i] == "\n" {
            column_breaks.push(i + 1);
            column_start = i + 1;
            current_height = 0.0;
            last_breakable = -1;
            column_index += 1;
            continue;
        }

        current_height += advances.get(i).copied().unwrap_or(0.0);

        if i > column_start {
            last_breakable = if let Some(break_set) = uax14_break_set {
                if break_set.get(i).copied().unwrap_or(false) {
                    i as isize
                } else {
                    last_breakable
                }
            } else {
                i as isize
            };
        }

        let max_height = max_heights[column_index.min(max_heights.len() - 1)];
        if current_height <= max_height || i <= column_start {
            continue;
        }

        // Check hanging punctuation
        if let Some(hanging) = hanging_chars {
            if let Some(ch) = chars[i].chars().next() {
                if hanging.contains(&ch) {
                    continue;
                }
            }
        }

        let (break_pos, unresolved) =
            resolve_break_pos(chars, last_breakable, column_start, i, kinsoku);
        if unresolved {
            kinsoku_unresolved = true;
        }

        column_breaks.push(break_pos);
        column_start = break_pos;
        current_height = 0.0;
        for j in column_start..=i {
            current_height += advances.get(j).copied().unwrap_or(0.0);
        }
        last_breakable = -1;
        column_index += 1;
    }

    FindBreaksResult {
        column_breaks,
        kinsoku_unresolved,
    }
}
