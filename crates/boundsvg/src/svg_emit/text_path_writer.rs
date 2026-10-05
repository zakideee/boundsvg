//! Compact serialization of already rounded text outlines.
//! Unsupported path syntax is passed through without changing the IR.

/// Maximum number of coordinates in an accepted cubic segment.
const COORDINATE_COUNT_MAX: usize = 6;
/// A line can emit absolute/relative L, H, and V variants.
const CHOICE_COUNT_MAX: usize = 6;

#[derive(Clone, Copy, Debug)]
struct Segment {
    op: u8,
    values: [i64; COORDINATE_COUNT_MAX],
    value_count: usize,
}

#[derive(Clone, Copy)]
struct Choice {
    op: u8,
    values: [i64; COORDINATE_COUNT_MAX],
    properties: [NumberProperties; COORDINATE_COUNT_MAX],
    value_count: usize,
    has_dot_mask: u8,
    starts_with_dot_mask: u8,
}

impl Choice {
    /// Empty path command choice used before coordinate candidates are populated.
    const EMPTY: Self = Self {
        op: 0,
        values: [0; COORDINATE_COUNT_MAX],
        properties: [NumberProperties::EMPTY; COORDINATE_COUNT_MAX],
        value_count: 0,
        has_dot_mask: 0,
        starts_with_dot_mask: 0,
    };

    fn coordinates(&self) -> &[i64] {
        &self.values[..self.value_count]
    }
}

struct Step {
    parent: usize,
    choice_op: u8,
    is_explicit: bool,
    length: usize,
    command: u8,
    last_had_dot: bool,
    has_dot_mask: u8,
    starts_with_dot_mask: u8,
}

#[derive(Clone, Copy)]
struct NumberProperties {
    length: u8,
    has_dot: bool,
    starts_with_dot: bool,
}

impl NumberProperties {
    /// Empty numeric spelling metadata used before a coordinate is formatted.
    const EMPTY: Self = Self {
        length: 0,
        has_dot: false,
        starts_with_dot: false,
    };
}

fn coordinate(bytes: &[u8], pos: &mut usize) -> Option<i64> {
    let negative = if bytes.get(*pos) == Some(&b'-') {
        *pos += 1;
        true
    } else {
        false
    };
    let mut integer = 0_i64;
    let mut digits = 0;
    while let Some(digit @ b'0'..=b'9') = bytes.get(*pos).copied() {
        integer = integer
            .checked_mul(10)?
            .checked_add(i64::from(digit - b'0'))?;
        *pos += 1;
        digits += 1;
    }
    let mut fraction = 0_i64;
    if bytes.get(*pos) == Some(&b'.') {
        *pos += 1;
        let mut count = 0;
        while let Some(digit @ b'0'..=b'9') = bytes.get(*pos).copied() {
            if count == 2 {
                return None;
            }
            fraction = fraction * 10 + i64::from(digit - b'0');
            *pos += 1;
            count += 1;
        }
        if count == 0 {
            return None;
        }
        digits += count;
        if count == 1 {
            fraction *= 10;
        }
    }
    if digits == 0 {
        return None;
    }
    let value = integer.checked_mul(100)?.checked_add(fraction)?;
    if negative {
        value.checked_neg()
    } else {
        Some(value)
    }
}

fn skip_whitespace(bytes: &[u8], pos: &mut usize) {
    while matches!(bytes.get(*pos), Some(b' ' | b'\t' | b'\r' | b'\n')) {
        *pos += 1;
    }
}

fn skip_coordinate_separator(bytes: &[u8], pos: &mut usize) {
    skip_whitespace(bytes, pos);
    if bytes.get(*pos) == Some(&b',') {
        *pos += 1;
        skip_whitespace(bytes, pos);
    }
}

fn parse(input: &str) -> Option<Vec<Segment>> {
    let bytes = input.as_bytes();
    let mut pos = 0;
    let mut segments = Vec::new();
    let mut needs_move = true;
    while pos < bytes.len() {
        skip_whitespace(bytes, &mut pos);
        if pos == bytes.len() {
            break;
        }
        let op = *bytes.get(pos)?;
        pos += 1;
        let arity = match op {
            b'M' => 2,
            b'L' if !needs_move => 2,
            b'Q' if !needs_move => 4,
            b'C' if !needs_move => 6,
            b'Z' if !needs_move => 0,
            _ => return None,
        };
        let mut values = [0; COORDINATE_COUNT_MAX];
        for (index, coordinate_value) in values.iter_mut().take(arity).enumerate() {
            if index == 0 {
                skip_whitespace(bytes, &mut pos);
            } else {
                skip_coordinate_separator(bytes, &mut pos);
            }
            *coordinate_value = coordinate(bytes, &mut pos)?;
        }
        if let Some(next) = bytes.get(pos) {
            if !matches!(
                next,
                b' ' | b'\t' | b'\r' | b'\n' | b'M' | b'L' | b'Q' | b'C' | b'Z'
            ) {
                return None;
            }
        }
        needs_move = op == b'Z';
        segments.push(Segment {
            op,
            values,
            value_count: arity,
        });
    }
    if segments.is_empty() {
        None
    } else {
        Some(segments)
    }
}

fn number_properties(value: i64) -> NumberProperties {
    let magnitude = value.unsigned_abs();
    let whole = magnitude / 100;
    let fraction = magnitude % 100;
    let sign_length = usize::from(value < 0);
    if fraction == 0 {
        let digits = if whole == 0 {
            1
        } else {
            whole.ilog10() as usize + 1
        };
        return NumberProperties {
            length: u8::try_from(sign_length + digits).unwrap_or(u8::MAX),
            has_dot: false,
            starts_with_dot: false,
        };
    }
    let whole_digits = if whole == 0 {
        0
    } else {
        whole.ilog10() as usize + 1
    };
    let fraction_digits = if fraction % 10 == 0 { 1 } else { 2 };
    NumberProperties {
        length: u8::try_from(sign_length + whole_digits + 1 + fraction_digits).unwrap_or(u8::MAX),
        has_dot: true,
        starts_with_dot: whole == 0,
    }
}

fn sequence_lengths(choice: &Choice) -> (usize, usize, usize, bool) {
    let mut length = 0;
    let mut dot = None;
    let mut first_separator_without_dot = 0;
    let mut first_separator_with_dot = 0;
    for (index, &value) in choice.coordinates().iter().enumerate() {
        let properties = choice.properties[index];
        if dot.is_none() {
            first_separator_without_dot = usize::from(value >= 0);
            first_separator_with_dot = usize::from(value >= 0 && !properties.starts_with_dot);
        }
        if dot.is_some() && value >= 0 && !(properties.starts_with_dot && dot == Some(true)) {
            length += 1;
        }
        length += usize::from(properties.length);
        dot = Some(properties.has_dot);
    }
    (
        length,
        length + first_separator_without_dot,
        length + first_separator_with_dot,
        dot.unwrap_or(false),
    )
}

fn append_number(output: &mut String, value: i64) {
    if value < 0 {
        output.push('-');
    }
    let magnitude = value.unsigned_abs();
    let whole = magnitude / 100;
    let fraction = magnitude % 100;
    if whole != 0 || fraction == 0 {
        let mut digits = [0_u8; 20];
        let mut index = digits.len();
        let mut remaining = whole;
        loop {
            index -= 1;
            digits[index] = b'0' + (remaining % 10) as u8;
            remaining /= 10;
            if remaining == 0 {
                break;
            }
        }
        for &digit in &digits[index..] {
            output.push(char::from(digit));
        }
    }
    if fraction != 0 {
        output.push('.');
        if fraction % 10 == 0 {
            output.push(char::from(b'0' + (fraction / 10) as u8));
        } else {
            output.push(char::from(b'0' + (fraction / 10) as u8));
            output.push(char::from(b'0' + (fraction % 10) as u8));
        }
    }
}

fn append_numbers(
    output: &mut String,
    values: &[i64],
    previous_dot: Option<bool>,
    has_dot_mask: u8,
    starts_with_dot_mask: u8,
) {
    let mut dot = previous_dot;
    for (index, &value) in values.iter().enumerate() {
        let has_dot = (has_dot_mask & (1 << index)) != 0;
        let starts_with_dot = (starts_with_dot_mask & (1 << index)) != 0;
        if dot.is_some() && value >= 0 && !(starts_with_dot && dot == Some(true)) {
            output.push(' ');
        }
        append_number(output, value);
        dot = Some(has_dot);
    }
}

fn add_choice(
    choices: &mut [Choice; CHOICE_COUNT_MAX],
    count: &mut usize,
    op: u8,
    values: &[i64],
    properties: &[NumberProperties],
) {
    let mut coordinates = [0; COORDINATE_COUNT_MAX];
    let mut number_properties = [NumberProperties::EMPTY; COORDINATE_COUNT_MAX];
    let mut has_dot_mask = 0;
    let mut starts_with_dot_mask = 0;
    coordinates[..values.len()].copy_from_slice(values);
    number_properties[..values.len()].copy_from_slice(properties);
    for (index, property) in properties.iter().enumerate() {
        has_dot_mask |= u8::from(property.has_dot) << index;
        starts_with_dot_mask |= u8::from(property.starts_with_dot) << index;
    }
    choices[*count] = Choice {
        op,
        values: coordinates,
        properties: number_properties,
        value_count: values.len(),
        has_dot_mask,
        starts_with_dot_mask,
    };
    *count += 1;
}

fn choices(
    segment: &Segment,
    point: [i64; 2],
    previous: Option<&Segment>,
) -> Option<([Choice; CHOICE_COUNT_MAX], usize)> {
    let op = segment.op;
    let values = &segment.values[..segment.value_count];
    let mut result = [Choice::EMPTY; CHOICE_COUNT_MAX];
    let mut count = 0;
    let mut absolute_properties = [NumberProperties::EMPTY; COORDINATE_COUNT_MAX];
    for (index, &value) in values.iter().enumerate() {
        absolute_properties[index] = number_properties(value);
    }
    add_choice(
        &mut result,
        &mut count,
        op,
        values,
        &absolute_properties[..values.len()],
    );
    if op == b'M' || op == b'Z' {
        return Some((result, count));
    }
    let mut relative = [0; COORDINATE_COUNT_MAX];
    let mut relative_properties = [NumberProperties::EMPTY; COORDINATE_COUNT_MAX];
    for (index, value) in values.iter().enumerate() {
        relative[index] = value.checked_sub(point[index % 2])?;
        relative_properties[index] = number_properties(relative[index]);
    }
    add_choice(
        &mut result,
        &mut count,
        op.to_ascii_lowercase(),
        &relative[..values.len()],
        &relative_properties[..values.len()],
    );
    if op == b'L' {
        if values[1] == point[1] {
            add_choice(
                &mut result,
                &mut count,
                b'H',
                &values[..1],
                &absolute_properties[..1],
            );
            add_choice(
                &mut result,
                &mut count,
                b'h',
                &relative[..1],
                &relative_properties[..1],
            );
        }
        if values[0] == point[0] {
            add_choice(
                &mut result,
                &mut count,
                b'V',
                &values[1..2],
                &absolute_properties[1..2],
            );
            add_choice(
                &mut result,
                &mut count,
                b'v',
                &relative[1..2],
                &relative_properties[1..2],
            );
        }
    }
    if let Some(previous) = previous {
        if op == b'Q' && previous.op == b'Q' {
            let x = point[0].checked_mul(2)?.checked_sub(previous.values[0])?;
            let y = point[1].checked_mul(2)?.checked_sub(previous.values[1])?;
            if values[..2] == [x, y] {
                add_choice(
                    &mut result,
                    &mut count,
                    b'T',
                    &values[2..4],
                    &absolute_properties[2..4],
                );
                add_choice(
                    &mut result,
                    &mut count,
                    b't',
                    &relative[2..4],
                    &relative_properties[2..4],
                );
            }
        }
        if op == b'C' && previous.op == b'C' {
            let x = point[0].checked_mul(2)?.checked_sub(previous.values[2])?;
            let y = point[1].checked_mul(2)?.checked_sub(previous.values[3])?;
            if values[..2] == [x, y] {
                add_choice(
                    &mut result,
                    &mut count,
                    b'S',
                    &values[2..6],
                    &absolute_properties[2..6],
                );
                add_choice(
                    &mut result,
                    &mut count,
                    b's',
                    &relative[2..6],
                    &relative_properties[2..6],
                );
            }
        }
    }
    Some((result, count))
}

fn selected_coordinates(
    segment: &Segment,
    point: [i64; 2],
    choice_op: u8,
) -> Option<([i64; COORDINATE_COUNT_MAX], usize)> {
    let (start_index, value_count) = match choice_op.to_ascii_uppercase() {
        b'M' | b'L' => (0, 2),
        b'Q' => (0, 4),
        b'C' => (0, 6),
        b'H' => (0, 1),
        b'V' => (1, 1),
        b'T' => (2, 2),
        b'S' => (2, 4),
        b'Z' => return Some(([0; COORDINATE_COUNT_MAX], 0)),
        _ => return None,
    };
    let mut values = [0; COORDINATE_COUNT_MAX];
    for (index, target) in values.iter_mut().take(value_count).enumerate() {
        let source_index = start_index + index;
        let value = segment.values[source_index];
        *target = if choice_op.is_ascii_lowercase() {
            value.checked_sub(point[source_index % 2])?
        } else {
            value
        };
    }
    Some((values, value_count))
}
#[expect(
    clippy::needless_range_loop,
    clippy::semicolon_if_nothing_returned,
    reason = "the indexed DP backpointer scan and segment-state match preserve measured emission performance"
)]
fn write_segments(segments: &[Segment]) -> Option<String> {
    let mut steps = Vec::with_capacity(segments.len().checked_mul(4)?.checked_add(1)?);
    steps.push(Step {
        parent: 0,
        choice_op: 0,
        is_explicit: true,
        length: 0,
        command: 0,
        last_had_dot: false,
        has_dot_mask: 0,
        starts_with_dot_mask: 0,
    });
    let mut layer_start = 0;
    let mut point = [0, 0];
    let mut start = [0, 0];
    let mut previous: Option<&Segment> = None;
    for segment in segments {
        let (options, option_count) = choices(segment, point, previous)?;
        let layer_end = steps.len();
        let best_parent = (layer_start..layer_end).min_by_key(|&index| steps[index].length)?;
        for choice in options.iter().take(option_count) {
            let (explicit_numbers_length, implicit_without_dot, implicit_with_dot, last_had_dot) =
                sequence_lengths(choice);
            let mut best_length = steps[best_parent]
                .length
                .checked_add(1 + explicit_numbers_length)?;
            let mut parent = best_parent;
            let mut is_explicit = true;
            if choice.op != b'M' && choice.op != b'Z' {
                for prior_index in layer_start..layer_end {
                    let prior = &steps[prior_index];
                    if prior.command != choice.op {
                        continue;
                    }
                    let numbers_length = if prior.last_had_dot {
                        implicit_with_dot
                    } else {
                        implicit_without_dot
                    };
                    let candidate_length = prior.length.checked_add(numbers_length)?;
                    if candidate_length < best_length {
                        best_length = candidate_length;
                        parent = prior_index;
                        is_explicit = false;
                    }
                }
            }
            let command = match choice.op {
                b'M' => b'L',
                b'Z' => 0,
                other => other,
            };
            steps.push(Step {
                parent,
                choice_op: choice.op,
                is_explicit,
                length: best_length,
                command,
                last_had_dot,
                has_dot_mask: choice.has_dot_mask,
                starts_with_dot_mask: choice.starts_with_dot_mask,
            });
        }
        layer_start = layer_end;
        match segment.op {
            b'M' => {
                point = [segment.values[0], segment.values[1]];
                start = point;
            }
            b'Z' => point = start,
            _ => {
                point = [
                    segment.values[segment.value_count - 2],
                    segment.values[segment.value_count - 1],
                ]
            }
        }
        previous = if segment.op == b'Z' {
            None
        } else {
            Some(segment)
        };
    }
    let best_index = (layer_start..steps.len()).min_by_key(|&index| steps[index].length)?;
    let mut selected_steps = Vec::with_capacity(segments.len());
    let mut index = best_index;
    while index != 0 {
        selected_steps.push(index);
        index = steps[index].parent;
    }
    selected_steps.reverse();
    let mut output = String::with_capacity(steps[best_index].length);
    point = [0, 0];
    start = [0, 0];
    for (segment, step_index) in segments.iter().zip(selected_steps) {
        let step = &steps[step_index];
        let choice_op = step.choice_op;
        let (coordinates, value_count) = selected_coordinates(segment, point, choice_op)?;
        if step.is_explicit {
            output.push(char::from(if choice_op == b'Z' { b'z' } else { choice_op }));
        }
        append_numbers(
            &mut output,
            &coordinates[..value_count],
            if step.is_explicit {
                None
            } else {
                Some(steps[step.parent].last_had_dot)
            },
            step.has_dot_mask,
            step.starts_with_dot_mask,
        );
        match segment.op {
            b'M' => {
                point = [segment.values[0], segment.values[1]];
                start = point;
            }
            b'Z' => point = start,
            _ => {
                point = [
                    segment.values[segment.value_count - 2],
                    segment.values[segment.value_count - 1],
                ]
            }
        }
    }
    if output.len() == steps[best_index].length {
        Some(output)
    } else {
        None
    }
}

/// Use a shorter equivalent path spelling when parsing and rewriting succeed; otherwise preserve the input.
pub(super) fn compact_text_path(input: &str) -> String {
    let Some(output) = parse(input).and_then(|segments| write_segments(&segments)) else {
        return input.to_owned();
    };
    if output.len() < input.len() {
        output
    } else {
        input.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::{append_number, choices, compact_text_path, number_properties, parse};
    use svgtypes::{SimplePathSegment, SimplifyingPathParser};

    fn canonical_segments(path: &str) -> Vec<(u8, Vec<i64>)> {
        fn hundredths(value: f64) -> i64 {
            let scaled = value * 100.0;
            assert!((scaled - scaled.round()).abs() < 1e-7);
            scaled
                .round()
                .to_string()
                .parse()
                .expect("integer coordinate")
        }

        SimplifyingPathParser::from(path)
            .map(|item| match item.expect("valid SVG path") {
                SimplePathSegment::MoveTo { x, y } => (b'M', vec![hundredths(x), hundredths(y)]),
                SimplePathSegment::LineTo { x, y } => (b'L', vec![hundredths(x), hundredths(y)]),
                SimplePathSegment::Quadratic { x1, y1, x, y } => (
                    b'Q',
                    vec![hundredths(x1), hundredths(y1), hundredths(x), hundredths(y)],
                ),
                SimplePathSegment::CurveTo {
                    x1,
                    y1,
                    x2,
                    y2,
                    x,
                    y,
                } => (
                    b'C',
                    vec![
                        hundredths(x1),
                        hundredths(y1),
                        hundredths(x2),
                        hundredths(y2),
                        hundredths(x),
                        hundredths(y),
                    ],
                ),
                SimplePathSegment::ClosePath => (b'Z', vec![]),
            })
            .collect()
    }

    fn next_coordinate(state: &mut u64) -> i64 {
        *state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1);
        i64::try_from((*state >> 32) % 4001).expect("bounded coordinate") - 2000
    }

    fn push_coordinate(path: &mut String, value: i64) {
        use std::fmt::Write;
        let magnitude = value.unsigned_abs();
        let sign = if value < 0 { "-" } else { "" };
        let _ = write!(path, " {sign}{}.{:02}", magnitude / 100, magnitude % 100);
    }

    #[test]
    fn shortens_rounded_outline() {
        assert_eq!(compact_text_path("M 0 0 L 1 0 L 1 2 Z"), "M0 0H1V2z");
    }

    #[test]
    fn preserves_unsupported_input() {
        for input in [
            "M0 0L1 2 3 4Z",
            "M+0 0L1 2Z",
            "M0 0L1. 2Z",
            "M0 0h1z",
            "M0 0L1.234 2Z",
        ] {
            assert_eq!(compact_text_path(input), input);
        }
    }

    #[test]
    fn preserves_misplaced_or_repeated_commas() {
        for input in [
            "M0 0L10 0L10 10Z,M20 20L30 20L30 30Z",
            "M,0 0L10 0L10 10Z",
            "M0,0L,10 0L10 10Z",
            "M0,,0L10 0L10 10Z",
            ",M0 0L1 1Z",
            "M0 0L1 1Z,",
        ] {
            assert_eq!(compact_text_path(input), input);
        }
    }

    #[test]
    fn shortens_valid_multi_subpath_separators() {
        for input in [
            "M0,0L10,0L10,10Z M20,20L30,20L30,30Z",
            "M0 0L10 0L10 10Z\nM20 20L30 20L30 30Z",
        ] {
            let output = compact_text_path(input);
            assert!(output.len() < input.len());
            assert_eq!(canonical_segments(&output), canonical_segments(input));
        }
    }

    #[test]
    fn resets_reflection_and_position_at_each_subpath() {
        let input = "M 0 0 Q 1 1 2 0 Z M 5 5 Q 9 9 7 5 Z";
        let output = compact_text_path(input);
        assert!(output.starts_with('M'));
        assert!(output.contains("zM"));
        assert!(!output.contains('T') && !output.contains('t'));
        assert_eq!(canonical_segments(&output), canonical_segments(input));
    }

    #[test]
    fn accepts_negative_zero_and_falls_back_on_checked_overflow() {
        assert_eq!(compact_text_path("M-0 -0L1 0"), "M0 0H1");
        let oversized = "M92233720368547759 0L1 0";
        assert_eq!(compact_text_path(oversized), oversized);
    }

    #[test]
    fn decimal_writer_preserves_boundary_tokens() {
        for value in [
            i64::MIN,
            -10_010,
            -100,
            -10,
            -1,
            0,
            1,
            10,
            100,
            10_010,
            i64::MAX,
        ] {
            let magnitude = value.unsigned_abs();
            let whole = magnitude / 100;
            let fraction = magnitude % 100;
            let sign = if value < 0 { "-" } else { "" };
            let expected = if fraction == 0 {
                format!("{sign}{whole}")
            } else if whole == 0 {
                if fraction % 10 == 0 {
                    format!("{sign}.{}", fraction / 10)
                } else {
                    format!("{sign}.{fraction:02}")
                }
            } else if fraction % 10 == 0 {
                format!("{sign}{whole}.{}", fraction / 10)
            } else {
                format!("{sign}{whole}.{fraction:02}")
            };
            let mut actual = String::new();
            append_number(&mut actual, value);
            assert_eq!(actual, expected);
            assert_eq!(usize::from(number_properties(value).length), actual.len());
        }
    }

    #[test]
    fn generated_paths_preserve_every_segment_and_control_point() {
        let mut state = 0x5eed_2026_u64;
        for case in 0..128 {
            let mut input = String::new();
            for _ in 0..=(case % 3) {
                input.push('M');
                push_coordinate(&mut input, next_coordinate(&mut state));
                push_coordinate(&mut input, next_coordinate(&mut state));
                for _ in 0..=(case % 11) {
                    let op = match next_coordinate(&mut state).unsigned_abs() % 3 {
                        0 => 'L',
                        1 => 'Q',
                        _ => 'C',
                    };
                    input.push(op);
                    let coordinate_count = match op {
                        'L' => 2,
                        'Q' => 4,
                        _ => 6,
                    };
                    for _ in 0..coordinate_count {
                        push_coordinate(&mut input, next_coordinate(&mut state));
                    }
                }
                input.push('Z');
            }
            let output = compact_text_path(&input);
            assert_eq!(
                canonical_segments(&output),
                canonical_segments(&input),
                "case {case}"
            );
        }
    }

    #[test]
    fn generated_special_cases_reach_each_candidate_and_preserve_geometry() {
        let mut state = 0x5eed_2026_u64;
        let mut candidate_counts = [0_usize; 4];
        let mut close_reflection_cases = 0;
        for case in 0..64 {
            let offset = next_coordinate(&mut state);
            let x = offset / 100;
            let input = format!(
                "M{x} 0L{} 0L{} 10Q{} 15 {} 10Q{} 5 {} 10C{} 11 {} 12 {} 13C{} 14 {} 15 {} 16Q{} 18 {} 20ZM{} 50Q{} 82 {} 50Z",
                x + 10,
                x + 10,
                x + 15,
                x + 20,
                x + 25,
                x + 30,
                x + 31,
                x + 32,
                x + 33,
                x + 34,
                x + 35,
                x + 36,
                x + 38,
                x + 40,
                x + 50,
                x + 62,
                x + 57,
            );
            let segments = parse(&input).expect("valid generated path");
            let mut point = [0, 0];
            let mut start = [0, 0];
            let mut previous = None;
            let mut before_close = None;
            let mut after_close = false;
            for segment in &segments {
                let (options, count) =
                    choices(segment, point, previous).expect("candidate choices");
                for choice in options.iter().take(count) {
                    match choice.op {
                        b'H' => candidate_counts[0] += 1,
                        b'V' => candidate_counts[1] += 1,
                        b'S' => candidate_counts[2] += 1,
                        b'T' => candidate_counts[3] += 1,
                        _ => {}
                    }
                }
                if after_close && segment.op == b'Q' {
                    let (stale_options, stale_count) =
                        choices(segment, point, before_close).expect("stale reflection choices");
                    assert!(
                        stale_options[..stale_count]
                            .iter()
                            .any(|choice| choice.op == b'T')
                    );
                    assert!(!options[..count].iter().any(|choice| choice.op == b'T'));
                    close_reflection_cases += 1;
                    after_close = false;
                }
                match segment.op {
                    b'M' => {
                        point = [segment.values[0], segment.values[1]];
                        start = point;
                    }
                    b'Z' => {
                        before_close = previous;
                        point = start;
                        after_close = true;
                    }
                    _ => {
                        point = [
                            segment.values[segment.value_count - 2],
                            segment.values[segment.value_count - 1],
                        ];
                    }
                }
                previous = if segment.op == b'Z' {
                    None
                } else {
                    Some(segment)
                };
            }
            let output = compact_text_path(&input);
            assert_eq!(
                canonical_segments(&output),
                canonical_segments(&input),
                "case {case}"
            );
        }
        assert!(
            candidate_counts.iter().all(|&count| count >= 64),
            "{candidate_counts:?}"
        );
        assert_eq!(close_reflection_cases, 64);
    }
}
