use crate::text::types::WrapMode;

// ---------------------------------------------------------------------------
// Break point detection
// ---------------------------------------------------------------------------

/// Find the most recent breakable position at or before `i`.
pub(super) fn find_breakable(
    wrap: WrapMode,
    i: usize,
    line_start: usize,
    uax14_break_set: Option<&[bool]>,
    chars: &[&str],
    last_breakable: Option<usize>,
) -> Option<usize> {
    if i <= line_start {
        return last_breakable;
    }

    if let Some(break_set) = uax14_break_set {
        if i < break_set.len() && break_set[i] {
            return Some(i);
        }
        return last_breakable;
    }

    if wrap == WrapMode::Char {
        return Some(i);
    }

    // wrap == Word
    if i > 0 && is_word_break(chars, i - 1) {
        return Some(i);
    }

    last_breakable
}

/// Build UAX#14 break set as a boolean vec (char-indexed).
/// When `uax14_breaks` is None, computes breaks internally via `unicode_linebreak`.
pub(super) fn build_uax14_break_set(
    chars: &[&str],
    uax14_breaks: Option<&[usize]>,
    text: &str,
) -> Option<Vec<bool>> {
    let breaks: Vec<usize> = match uax14_breaks {
        Some(b) if !b.is_empty() => b.to_vec(),
        _ => super::super::linebreak::uax14_break_opportunities(text),
    };
    if breaks.is_empty() {
        return None;
    }
    let uax14_breaks = &breaks;

    // Build byte offset → char index mapping
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
    // Map end-of-string
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
// Word boundary detection (ported from word-boundary.ts)
// ---------------------------------------------------------------------------

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

/// Determine if a line break is allowed between chars[i] and chars[i+1].
pub(super) fn is_word_break(chars: &[&str], i: usize) -> bool {
    if i >= chars.len().saturating_sub(1) {
        return false;
    }

    let current_cp = match chars[i].chars().next() {
        Some(c) => c as u32,
        None => return false,
    };
    let next_cp = match chars[i + 1].chars().next() {
        Some(c) => c as u32,
        None => return false,
    };

    // Rule 1: after ASCII whitespace
    if is_ascii_whitespace(current_cp) {
        return true;
    }

    // Rule 2: before or after CJK character
    if is_cjk(current_cp) || is_cjk(next_cp) {
        return true;
    }

    // Rule 3: after hyphen
    if is_hyphen(current_cp) {
        return true;
    }

    false
}
