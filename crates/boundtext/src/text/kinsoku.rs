//! JLREQ/JIS X 4051-informed kinsoku (禁則) processing for Japanese text.
//!
//! Ported from packages/core/src/text/kinsoku/ja.ts + kinsoku/index.ts.

/// Maximum characters to backtrack for kinsoku resolution.
const MAX_KINSOKU_BACKTRACK: usize = 8;

/// Shared tolerance for classifying and containing intentional inline overflow.
pub(crate) const INLINE_OVERFLOW_EPSILON: f64 = 1e-6;

/// Add intentional overflow without allowing the exempted tail to grow beyond
/// one complete region. Layout may still preserve a longer kinsoku sequence,
/// but fit and shrinkwrap must then reject it as uncontained.
#[must_use]
pub(crate) fn add_bounded_intentional_overflow_px(
    current: f64,
    next_advance: f64,
    capacity: f64,
) -> f64 {
    let candidate = current + next_advance;
    if candidate <= capacity.max(0.0) + INLINE_OVERFLOW_EPSILON {
        candidate
    } else {
        current
    }
}

// ---------------------------------------------------------------------------
// Character tables (const arrays for O(n) lookup via contains())
// ---------------------------------------------------------------------------

/// `JaTypesettingV1` 行頭禁止文字 — characters forbidden at line start.
///
/// This is intentionally close to JLREQ level 3 rather than the previous
/// very-strict profile. Small kana, prolonged sound marks, and iteration marks
/// are kept in `HEAD_PROHIBIT_VERY_STRICT_EXTRA` for future opt-in behavior.
const HEAD_PROHIBIT_JA_TYPESSETTING_V1: &[char] = &[
    // Punctuation
    '、', '。', '，', '．', '・', '：', '；', '？', '！', // Ellipsis
    '…', '‥', // Closing brackets
    '）', '］', '｝', '〕', '〉', '》', '」', '』', '】', // Closing bracket variants
    '〗', '〙', // Voicing marks
    '゛', '゜', // Compound exclamation/question marks
    '‼', '⁇', '⁈', '⁉',  // Katakana double hyphen
    '゠', // Dashes
    '–', '—', '‐', // Closing smart quotes
    '\u{2019}', '\u{201D}', // Halfwidth punctuation
    '｡', '､', '｣', // Halfwidth voicing marks
    'ﾞ', 'ﾟ',
];

/// Extra 行頭禁止文字 for the old very-strict profile.
const HEAD_PROHIBIT_VERY_STRICT_EXTRA: &[char] = &[
    // Prolonged sound / wave dash
    'ー', '〜', '～', // Small kana
    'ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'っ', 'ゃ', 'ゅ', 'ょ', 'ゎ', 'ァ', 'ィ', 'ゥ', 'ェ', 'ォ', 'ッ',
    'ャ', 'ュ', 'ョ', 'ヮ', 'ヵ', 'ヶ', // Small kana additions
    'ゕ', 'ゖ', // Ainu extended small katakana (U+31F0-31FF)
    'ㇰ', 'ㇱ', 'ㇲ', 'ㇳ', 'ㇴ', 'ㇵ', 'ㇶ', 'ㇷ', 'ㇸ', 'ㇹ', 'ㇺ', 'ㇻ', 'ㇼ', 'ㇽ', 'ㇾ', 'ㇿ',
    // Iteration marks
    '々', '〻', 'ゝ', 'ゞ', 'ヽ', 'ヾ', // Halfwidth small kana / prolonged sound
    'ｧ', 'ｨ', 'ｩ', 'ｪ', 'ｫ', 'ｬ', 'ｭ', 'ｮ', 'ｯ', 'ｰ',
];

/// 行末禁止文字 — characters forbidden at line end
const TAIL_PROHIBIT: &[char] = &[
    '（', '［', '｛', '〔', '〈', '《', '「', '『', '【',
    // Opening bracket variants (JLREQ)
    '〖', '〘', // Opening smart quotes
    '\u{2018}', '\u{201C}', // Halfwidth opening bracket
    '｢',
];

/// 分離禁止 — non-breaking pairs (char, char)
const NON_BREAKING_PAIRS: &[(char, char)] = &[('—', '—'), ('…', '…'), ('‥', '‥')];

/// ぶら下げ許可文字 — characters allowed to hang past the line end
const HANGING_CHARS: &[char] = &[
    // Japanese punctuation
    '。', '、', // Closing brackets (CJK)
    '」', '）', '』', '】', '〉', '》', // Marks
    '！', '？', // Latin punctuation
    ',', '.', '!', '?', ')', ']', '}', // Halfwidth punctuation
    '｡', '､', '｣',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KinsokuStrictness {
    /// Default Japanese profile for boundsvg v0.1.
    JaTypesettingV1,
    /// Previous stronger profile retained internally for future opt-in APIs.
    VeryStrict,
}

/// Kinsoku profile for a language.
#[derive(Debug)]
pub struct KinsokuProfile {
    strictness: KinsokuStrictness,
    head_prohibit: &'static [char],
    extra_head_prohibit: &'static [char],
    tail_prohibit: &'static [char],
    non_breaking_pairs: &'static [(char, char)],
}

static JA_PROFILE: KinsokuProfile = KinsokuProfile {
    strictness: KinsokuStrictness::JaTypesettingV1,
    head_prohibit: HEAD_PROHIBIT_JA_TYPESSETTING_V1,
    extra_head_prohibit: &[],
    tail_prohibit: TAIL_PROHIBIT,
    non_breaking_pairs: NON_BREAKING_PAIRS,
};

static JA_VERY_STRICT_PROFILE: KinsokuProfile = KinsokuProfile {
    strictness: KinsokuStrictness::VeryStrict,
    head_prohibit: HEAD_PROHIBIT_JA_TYPESSETTING_V1,
    extra_head_prohibit: HEAD_PROHIBIT_VERY_STRICT_EXTRA,
    tail_prohibit: TAIL_PROHIBIT,
    non_breaking_pairs: NON_BREAKING_PAIRS,
};

impl KinsokuProfile {
    #[must_use]
    pub fn strictness(&self) -> KinsokuStrictness {
        self.strictness
    }
}

/// Get the kinsoku profile for a language.
///
/// - `Some("ja")` → Japanese kinsoku
/// - Everything else (`Some("en")`, `Some("auto")`, `None`) → no kinsoku
#[must_use]
pub fn get_kinsoku_profile(language: Option<&str>) -> Option<&'static KinsokuProfile> {
    match language {
        Some("ja") => Some(&JA_PROFILE),
        _ => None,
    }
}

/// Get a Japanese kinsoku profile by strictness.
#[must_use]
pub fn get_ja_kinsoku_profile(strictness: KinsokuStrictness) -> &'static KinsokuProfile {
    match strictness {
        KinsokuStrictness::JaTypesettingV1 => &JA_PROFILE,
        KinsokuStrictness::VeryStrict => &JA_VERY_STRICT_PROFILE,
    }
}

/// Get the hanging characters set (returns None if hanging punctuation is disabled).
#[must_use]
pub fn get_hanging_chars(enabled: bool) -> Option<&'static [char]> {
    if enabled { Some(HANGING_CHARS) } else { None }
}

/// Check if a character is a hanging punctuation character.
#[must_use]
pub fn is_hanging_char(ch: char, hanging_chars: Option<&[char]>) -> bool {
    hanging_chars.is_some_and(|chars| chars.contains(&ch))
}

/// Whether `text` is exactly one scalar-value hanging punctuation grapheme.
/// Atomic rich-text tokens may contain multiple graphemes and must never gain
/// a containment exemption just because their first character can hang.
#[must_use]
pub(crate) fn is_single_hanging_grapheme(text: &str, hanging_chars: Option<&[char]>) -> bool {
    let mut characters = text.chars();
    let Some(character) = characters.next() else {
        return false;
    };
    characters.next().is_none() && is_hanging_char(character, hanging_chars)
}

/// Advance that is intentionally allowed beyond `capacity` when a fragment
/// ends in one or more hanging punctuation graphemes. The aggregate allowance
/// is capped to one region so pathological punctuation runs remain uncontained.
///
/// Returns zero unless the non-hanging prefix fits and the complete fragment
/// actually overflows. Keeping the allowance explicit lets containment reject
/// unrelated overflow earlier in the same fragment.
#[must_use]
pub(crate) fn intentional_hanging_overflow_px(
    start: usize,
    end: usize,
    advances: &[f64],
    capacity: f64,
    graphemes: &[&str],
    hanging_chars: Option<&[char]>,
) -> f64 {
    if end <= start + 1 || end > advances.len() || end > graphemes.len() {
        return 0.0;
    }

    let mut hanging_start = end;
    while hanging_start > start
        && is_single_hanging_grapheme(graphemes[hanging_start - 1], hanging_chars)
    {
        hanging_start -= 1;
    }
    if hanging_start == start || hanging_start == end {
        return 0.0;
    }

    let prefix_advance = advances[start..hanging_start].iter().sum::<f64>();
    let hanging_advance = advances[hanging_start..end].iter().sum::<f64>();
    let full_advance = prefix_advance + hanging_advance;
    if prefix_advance <= capacity + INLINE_OVERFLOW_EPSILON
        && full_advance > capacity + INLINE_OVERFLOW_EPSILON
        && hanging_advance <= capacity.max(0.0) + INLINE_OVERFLOW_EPSILON
    {
        hanging_advance
    } else {
        0.0
    }
}

/// Check if a character is head-prohibit (forbidden at line start).
#[must_use]
pub fn is_head_prohibit(ch: char, profile: &KinsokuProfile) -> bool {
    profile.head_prohibit.contains(&ch) || profile.extra_head_prohibit.contains(&ch)
}

/// Check if a character is tail-prohibit (forbidden at line end).
#[must_use]
pub fn is_tail_prohibit(ch: char, profile: &KinsokuProfile) -> bool {
    profile.tail_prohibit.contains(&ch)
}

/// Check if a character pair must not be split by a line break.
#[must_use]
pub fn is_non_breaking_pair(prev: char, next: char, profile: &KinsokuProfile) -> bool {
    profile
        .non_breaking_pairs
        .iter()
        .any(|&(left, right)| left == prev && right == next)
}

/// Check if a character is an ASCII digit (0-9).
fn is_ascii_digit(ch: char) -> bool {
    ch.is_ascii_digit()
}

/// Check if breaking between chars[pos-1] and chars[pos] would split
/// a non-breaking pair or consecutive ASCII digits.
fn would_split_non_breaking(chars: &[&str], pos: usize, profile: &KinsokuProfile) -> bool {
    if pos == 0 || pos >= chars.len() {
        return false;
    }

    let prev = boundary_tail_char(chars[pos - 1]);
    let next = first_char(chars[pos]);
    let (Some(prev), Some(next)) = (prev, next) else {
        return false;
    };

    if is_non_breaking_pair(prev, next, profile) {
        return true;
    }

    // Consecutive ASCII digit protection
    if is_ascii_digit(prev) && is_ascii_digit(next) {
        return true;
    }

    false
}

/// Adjust a forced break position (used when kinsoku backtracking fails)
/// so it at least does not split a non-breaking pair or digit run.
///
/// Head/tail prohibitions are already known to be unresolvable at this
/// point; splitting 分離禁止 pairs is strictly worse than violating them,
/// so step backward until the boundary no longer splits a pair. Returns
/// `forced` unchanged when no pair-safe position exists above `line_start`.
#[must_use]
pub fn avoid_non_breaking_pair_split(
    chars: &[&str],
    forced: usize,
    line_start: usize,
    profile: &KinsokuProfile,
) -> usize {
    avoid_non_breaking_pair_split_by_boundary(chars, forced, line_start, |_| Some(profile))
}

/// Boundary-aware variant used by rich text whose language can change
/// between inline runs.
#[must_use]
pub(crate) fn avoid_non_breaking_pair_split_by_boundary<'a>(
    chars: &[&str],
    forced: usize,
    line_start: usize,
    mut profile_at: impl FnMut(usize) -> Option<&'a KinsokuProfile>,
) -> usize {
    let mut candidate = forced;
    while candidate > line_start {
        let Some(profile) = profile_at(candidate) else {
            return candidate;
        };
        if !would_split_non_breaking(chars, candidate, profile) {
            return candidate;
        }
        candidate = candidate.saturating_sub(1);
    }
    if candidate > line_start {
        candidate
    } else {
        forced
    }
}

/// Check whether breaking at `pos` (i.e. chars\[..pos\] on this line,
/// chars\[pos..\] on the next) satisfies all kinsoku constraints.
///
/// Returns `true` when the boundary is legal.  Used by both
/// [`apply_kinsoku`] (backward search) and the forward absorb pass in
/// `layout_next_flow_line`.
#[must_use]
pub fn is_valid_break_boundary(chars: &[&str], pos: usize, profile: &KinsokuProfile) -> bool {
    // chars[pos] would be the first character of the next line.
    if let Some(ch) = chars.get(pos).and_then(|t| first_char(t)) {
        if is_head_prohibit(ch, profile) {
            return false;
        }
    }

    // chars[pos - 1] would be the last character of the current line.
    if pos > 0 {
        if let Some(prev) = boundary_tail_char(chars[pos - 1]) {
            if is_tail_prohibit(prev, profile) {
                return false;
            }
        }
    }

    // Non-breaking pair / consecutive-digit protection.
    if would_split_non_breaking(chars, pos, profile) {
        return false;
    }

    true
}

/// Check if a position is a valid ellipsis truncation boundary.
///
/// Unlike [`is_valid_break_boundary`] (which validates line-break positions),
/// this only checks that the visible prefix does not end with a tail-prohibit
/// character (e.g. "（", "「"). Head-prohibit on the character at `pos` is
/// irrelevant because the suffix is hidden by "…", not moved to a new line.
/// Non-breaking pairs are also not checked: "…" replaces the continuation,
/// so there is no pair to split.
#[must_use]
pub fn is_valid_ellipsis_boundary(chars: &[&str], pos: usize, profile: &KinsokuProfile) -> bool {
    if pos == 0 {
        return true;
    }
    if let Some(prev) = first_char(chars[pos - 1]) {
        if is_tail_prohibit(prev, profile) {
            return false;
        }
    }
    true
}

/// Apply kinsoku rules to adjust a proposed break position.
///
/// `break_pos` is the index of the first char of the NEXT line.
/// Returns the adjusted break position, or a position <= `line_start`
/// if unresolvable.
#[must_use]
pub fn apply_kinsoku(
    chars: &[&str],
    break_pos: usize,
    line_start: usize,
    profile: &KinsokuProfile,
) -> usize {
    apply_kinsoku_by_boundary(chars, break_pos, line_start, |_| Some(profile))
}

/// Boundary-aware variant used by rich text whose language can change
/// between inline runs.
#[must_use]
pub(crate) fn apply_kinsoku_by_boundary<'a>(
    chars: &[&str],
    break_pos: usize,
    line_start: usize,
    mut profile_at: impl FnMut(usize) -> Option<&'a KinsokuProfile>,
) -> usize {
    let min_candidate = break_pos.saturating_sub(MAX_KINSOKU_BACKTRACK);

    let mut candidate = break_pos;
    while candidate > line_start && candidate >= min_candidate {
        let Some(profile) = profile_at(candidate) else {
            // The originally proposed neutral boundary remains valid, but a
            // kinsoku backtrack must not invent a word break inside a neutral
            // language run.
            return if candidate == break_pos {
                candidate
            } else {
                line_start
            };
        };
        if is_valid_break_boundary(chars, candidate, profile) {
            return candidate;
        }
        candidate -= 1;
    }

    // Unresolvable: no valid break within backtrack range
    line_start
}

/// Extract the first char from a grapheme cluster string slice.
fn first_char(text: &str) -> Option<char> {
    text.chars().next()
}

/// Character that participates in kinsoku at the trailing edge of a text
/// unit. Rich atomic tokens can contain multiple graphemes, so the line-end
/// character is the base character of the final grapheme rather than the
/// token's first scalar value.
fn boundary_tail_char(text: &str) -> Option<char> {
    #[cfg(feature = "unicode-full")]
    {
        use unicode_segmentation::UnicodeSegmentation;
        text.graphemes(true)
            .next_back()
            .and_then(|grapheme| grapheme.chars().next())
    }
    #[cfg(not(feature = "unicode-full"))]
    {
        text.chars().next_back()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_kinsoku_profile_ja() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        assert_eq!(profile.strictness(), KinsokuStrictness::JaTypesettingV1);
    }

    #[test]
    fn test_get_kinsoku_profile_auto_is_neutral() {
        assert!(get_kinsoku_profile(Some("auto")).is_none());
        assert!(get_kinsoku_profile(None).is_none());
    }

    #[test]
    fn test_get_kinsoku_profile_en() {
        assert!(get_kinsoku_profile(Some("en")).is_none());
    }

    #[test]
    fn test_head_prohibit_basic() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        assert!(is_head_prohibit('。', profile));
        assert!(is_head_prohibit('、', profile));
        assert!(is_head_prohibit('）', profile));
        assert!(is_head_prohibit('—', profile));
        assert!(!is_head_prohibit('あ', profile));
        assert!(!is_head_prohibit('A', profile));
    }

    #[test]
    fn ja_typesetting_v1_allows_level3_choice_characters_at_line_start() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        assert!(!is_head_prohibit('っ', profile));
        assert!(!is_head_prohibit('ァ', profile));
        assert!(!is_head_prohibit('ー', profile));
        assert!(!is_head_prohibit('々', profile));
    }

    #[test]
    fn very_strict_profile_keeps_previous_small_kana_sound_mark_and_iteration_rules() {
        let profile = get_ja_kinsoku_profile(KinsokuStrictness::VeryStrict);
        assert_eq!(profile.strictness(), KinsokuStrictness::VeryStrict);
        assert!(is_head_prohibit('っ', profile));
        assert!(is_head_prohibit('ァ', profile));
        assert!(is_head_prohibit('ー', profile));
        assert!(is_head_prohibit('々', profile));
    }

    #[test]
    fn test_tail_prohibit_basic() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        assert!(is_tail_prohibit('（', profile));
        assert!(is_tail_prohibit('「', profile));
        assert!(!is_tail_prohibit('あ', profile));
        assert!(!is_tail_prohibit('。', profile));
    }

    #[test]
    fn test_apply_kinsoku_head_prohibit() {
        // "あ。い" → break_pos=1 means "。" would start next line → prohibited
        let chars: Vec<&str> = vec!["あ", "。", "い"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let result = apply_kinsoku(&chars, 1, 0, profile);
        // Should backtrack: "。" can't start a line, but breaking at 0 means line_start
        // Actually break_pos=1 means next line starts with "。" which is head-prohibit.
        // Backtrack to candidate=0 which is <= line_start(0), so unresolvable → returns 0.
        assert_eq!(result, 0);
    }

    #[test]
    fn boundary_aware_backtracking_does_not_invent_a_neutral_word_break() {
        let chars = vec!["A", "P", "I", "。"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let result =
            apply_kinsoku_by_boundary(&chars, 3, 0, |boundary| (boundary == 3).then_some(profile));

        assert_eq!(result, 0);
        assert_eq!(
            apply_kinsoku_by_boundary(&chars, 2, 0, |_| None),
            2,
            "an originally proposed neutral boundary remains valid"
        );
    }

    #[test]
    fn test_apply_kinsoku_finds_valid_break() {
        // "ああ。い" → break_pos=2 means "。" would start next line → prohibited
        // Backtrack to candidate=1: "あ" can start a line, "あ" can end a line → valid
        let chars: Vec<&str> = vec!["あ", "あ", "。", "い"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let result = apply_kinsoku(&chars, 2, 0, profile);
        assert_eq!(result, 1);
    }

    #[test]
    fn test_apply_kinsoku_tail_prohibit() {
        // "あ「い" → break_pos=2, chars[1]="「" at line end → prohibited
        let chars: Vec<&str> = vec!["あ", "「", "い"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let result = apply_kinsoku(&chars, 2, 0, profile);
        // candidate=2: chars[1]="「" is tail-prohibit → skip
        // candidate=1: chars[0]="あ" is ok → valid
        assert_eq!(result, 1);
    }

    #[test]
    fn test_apply_kinsoku_non_breaking_pair() {
        // "—— " → shouldn't break between the two em dashes
        let chars: Vec<&str> = vec!["—", "—", " "];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let result = apply_kinsoku(&chars, 1, 0, profile);
        // candidate=1: "—" is head-prohibit → skip
        // falls to line_start = 0
        assert_eq!(result, 0);
    }

    #[test]
    fn test_apply_kinsoku_digit_protection() {
        // "a12b" → shouldn't break between "1" and "2"
        let chars: Vec<&str> = vec!["a", "1", "2", "b"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let result = apply_kinsoku(&chars, 2, 0, profile);
        // candidate=2: would split digits "1" and "2" → skip
        // candidate=1: "a" at line end, "1" at line start → valid
        assert_eq!(result, 1);
    }

    #[test]
    fn test_hanging_chars() {
        let hanging = get_hanging_chars(true);
        assert!(hanging.is_some());
        assert!(is_hanging_char('。', hanging));
        assert!(is_hanging_char(',', hanging));
        assert!(!is_hanging_char('あ', hanging));

        let no_hanging = get_hanging_chars(false);
        assert!(no_hanging.is_none());
        assert!(!is_hanging_char('。', no_hanging));
    }

    #[test]
    fn intentional_overflow_is_capped_to_one_region() {
        assert_eq!(add_bounded_intentional_overflow_px(0.0, 10.0, 20.0), 10.0);
        assert_eq!(add_bounded_intentional_overflow_px(10.0, 10.0, 20.0), 20.0);
        assert_eq!(add_bounded_intentional_overflow_px(20.0, 10.0, 20.0), 20.0);

        let advances = vec![10.0; 8];
        let graphemes = vec!["あ", "あ", "」", "。", "、", "、", "、", "い"];
        assert_eq!(
            intentional_hanging_overflow_px(
                0,
                7,
                &advances,
                20.0,
                &graphemes,
                get_hanging_chars(true),
            ),
            0.0
        );
    }

    // --- Extended kinsoku tests ---

    #[test]
    fn test_consecutive_head_prohibit_group() {
        // "ああ」）。い" → break_pos=2 means "」" starts next line → head-prohibit
        // All of 」）。 are head-prohibit, so backtrack to before them
        let chars: Vec<&str> = vec!["あ", "あ", "」", "）", "。", "い"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let result = apply_kinsoku(&chars, 2, 0, profile);
        // candidate=2: "」" head-prohibit → skip
        // candidate=1: "あ" ok → valid
        assert_eq!(result, 1);
    }

    #[test]
    fn test_tail_prohibit_at_line_end() {
        // "あ「い" at break_pos=2 → chars[1]="「" would be at line end → tail-prohibit
        let chars: Vec<&str> = vec!["あ", "「", "い"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let result = apply_kinsoku(&chars, 2, 0, profile);
        assert_eq!(result, 1);
    }

    #[test]
    fn test_tail_then_head_prohibit_interaction() {
        // "あ「。い" → break_pos=2 means "。" starts next line (head-prohibit)
        // candidate=2: "。" head-prohibit → skip
        // candidate=1: "あ" at end ok, "「" at next start is not head-prohibit → valid
        let chars: Vec<&str> = vec!["あ", "「", "。", "い"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let result = apply_kinsoku(&chars, 2, 0, profile);
        assert_eq!(result, 1);
    }

    #[test]
    fn test_backtrack_exhaustion() {
        // 10 head-prohibit chars → exceeds MAX_KINSOKU_BACKTRACK(8) → returns line_start
        let chars: Vec<&str> = vec![
            "あ", "。", "。", "。", "。", "。", "。", "。", "。", "。", "。", "い",
        ];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        // break_pos=10 → candidate scans 10→2 (8 steps) all "。" → exhausted → line_start
        let result = apply_kinsoku(&chars, 10, 0, profile);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_non_breaking_em_dash_pair() {
        // "あ——い" → break between the two dashes should be prevented
        let chars: Vec<&str> = vec!["あ", "—", "—", "い"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        // break_pos=2: "—" is head-prohibit → skip (also non-breaking pair)
        // break_pos=1: "—" is head-prohibit → skip
        // → returns line_start=0
        let result = apply_kinsoku(&chars, 2, 0, profile);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_non_breaking_ellipsis_pair() {
        // "あ……い" → break between the two ellipses prevented
        let chars: Vec<&str> = vec!["あ", "…", "…", "い"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        // break_pos=2: "…" is head-prohibit → skip
        // break_pos=1: "…" is head-prohibit → skip
        // → returns line_start=0
        let result = apply_kinsoku(&chars, 2, 0, profile);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_all_head_prohibit() {
        // All characters are head-prohibit → unresolvable
        let chars: Vec<&str> = vec!["。", "、", "！"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let result = apply_kinsoku(&chars, 1, 0, profile);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_empty_input() {
        let chars: Vec<&str> = vec![];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        // break_pos=0, line_start=0 → loop body doesn't execute → returns line_start
        let result = apply_kinsoku(&chars, 0, 0, profile);
        assert_eq!(result, 0);
    }

    #[test]
    fn test_break_pos_at_end_of_input() {
        let chars: Vec<&str> = vec!["縦", "中", "横"];
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let result = apply_kinsoku(&chars, chars.len(), 0, profile);
        assert_eq!(result, chars.len());
    }

    #[test]
    fn test_iteration_marks_head_prohibit() {
        let profile = get_ja_kinsoku_profile(KinsokuStrictness::VeryStrict);
        assert!(is_head_prohibit('ゝ', profile));
        assert!(is_head_prohibit('ゞ', profile));
        assert!(is_head_prohibit('ヽ', profile));
        assert!(is_head_prohibit('ヾ', profile));
    }

    #[test]
    fn test_halfwidth_head_prohibit() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        assert!(is_head_prohibit('｡', profile));
        assert!(is_head_prohibit('､', profile));
        assert!(is_head_prohibit('｣', profile));
        assert!(is_head_prohibit('ﾞ', profile));
        assert!(is_head_prohibit('ﾟ', profile));
    }

    #[test]
    fn test_halfwidth_tail_prohibit() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        assert!(is_tail_prohibit('｢', profile));
    }

    #[test]
    fn test_smart_quote_kinsoku() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        // Right quotes → head-prohibit (closing)
        assert!(is_head_prohibit('\u{2019}', profile)); // '
        assert!(is_head_prohibit('\u{201D}', profile)); // "
        // Left quotes → tail-prohibit (opening)
        assert!(is_tail_prohibit('\u{2018}', profile)); // '
        assert!(is_tail_prohibit('\u{201C}', profile)); // "
    }

    // ------------------------------------------------------------------
    // is_valid_break_boundary
    // ------------------------------------------------------------------

    #[test]
    fn test_valid_break_boundary_normal() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let chars = vec!["あ", "い", "う"];
        // Breaking at pos=1 → line="あ", next="い" — both normal chars
        assert!(is_valid_break_boundary(&chars, 1, profile));
    }

    #[test]
    fn test_valid_break_boundary_head_prohibit() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let chars = vec!["あ", "。", "い"];
        // Breaking at pos=1 → next starts with "。" → invalid
        assert!(!is_valid_break_boundary(&chars, 1, profile));
        // Breaking at pos=2 → next starts with "い" → valid
        assert!(is_valid_break_boundary(&chars, 2, profile));
    }

    #[test]
    fn test_valid_break_boundary_tail_prohibit() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let chars = vec!["あ", "（", "い"];
        // Breaking at pos=2 → line ends with "（" → invalid (tail-prohibit)
        assert!(!is_valid_break_boundary(&chars, 2, profile));
        // Breaking at pos=1 → line ends with "あ" → valid
        assert!(is_valid_break_boundary(&chars, 1, profile));
    }

    #[test]
    fn token_boundary_uses_the_final_grapheme_on_the_line_end_side() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();

        assert!(is_valid_break_boundary(&["「注」", "本"], 1, profile));
        assert!(!is_valid_break_boundary(&["本文（", "本"], 1, profile));
        assert!(is_valid_break_boundary(&["「注」", "5"], 1, profile));
        assert!(!is_valid_break_boundary(&["2026", "5"], 1, profile));
        assert!(is_valid_break_boundary(
            &["本文か\u{3099}", "本"],
            1,
            profile
        ));
    }

    #[test]
    fn test_valid_break_boundary_non_breaking_pair() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let chars = vec!["あ", "…", "…", "い"];
        // Breaking at pos=2 → splits "……" pair → invalid
        assert!(!is_valid_break_boundary(&chars, 2, profile));
        // pos=1 is also invalid because "…" is head-prohibit
        assert!(!is_valid_break_boundary(&chars, 1, profile));
        // pos=3 → next starts with "い" (ok), prev is "…" (not tail-prohibit) → valid
        assert!(is_valid_break_boundary(&chars, 3, profile));
    }

    #[test]
    fn test_valid_break_boundary_consecutive_digits() {
        let profile = get_kinsoku_profile(Some("ja")).unwrap();
        let chars = vec!["あ", "1", "2", "い"];
        // Breaking at pos=2 → splits "12" → invalid
        assert!(!is_valid_break_boundary(&chars, 2, profile));
        // Breaking at pos=1 or pos=3 → valid
        assert!(is_valid_break_boundary(&chars, 1, profile));
        assert!(is_valid_break_boundary(&chars, 3, profile));
    }
}
