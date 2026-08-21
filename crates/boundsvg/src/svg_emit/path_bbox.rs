//! Control-polygon bounding box for absolute SVG path data.
//!
//! Mirrors `parsePathBBox` in `packages/core/src/path/utils.ts`, including
//! its tokenizer regex `[MLHVQCZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?` and its
//! treatment of curve control points as bbox contributors.

use crate::ir::types::BBox;

#[derive(Debug, Clone, Copy, PartialEq)]
enum PathToken {
    Command(char),
    Number(f64),
}

/// Match the number alternative of the TS token regex at `bytes[start..]`.
/// Returns the end offset (exclusive) of the match, or `None`.
fn match_number_token(bytes: &[u8], start: usize) -> Option<usize> {
    let mut cursor = start;
    if bytes.get(cursor) == Some(&b'-') {
        cursor += 1;
    }
    let integer_digits = count_digits(bytes, cursor);
    cursor += integer_digits;
    if bytes.get(cursor) == Some(&b'.') {
        let fraction_digits = count_digits(bytes, cursor + 1);
        if fraction_digits > 0 {
            cursor += 1 + fraction_digits;
        } else if integer_digits == 0 {
            return None;
        }
        // With integer digits but no fraction digits the regex backtracks to
        // the digits-only form, leaving the dot unconsumed.
    } else if integer_digits == 0 {
        return None;
    }

    // (?:[eE][-+]?\d+)? — consumed only when the full exponent form matches
    if matches!(bytes.get(cursor), Some(b'e' | b'E')) {
        let mut exponent_cursor = cursor + 1;
        if matches!(bytes.get(exponent_cursor), Some(b'+' | b'-')) {
            exponent_cursor += 1;
        }
        let exponent_digits = count_digits(bytes, exponent_cursor);
        if exponent_digits > 0 {
            cursor = exponent_cursor + exponent_digits;
        }
    }
    Some(cursor)
}

fn count_digits(bytes: &[u8], start: usize) -> usize {
    bytes[start..]
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count()
}

/// Tokenize path data like the TS global regex: at each position match a
/// command letter or a number, otherwise skip one character.
fn tokenize(path_data: &str) -> Vec<PathToken> {
    let bytes = path_data.as_bytes();
    let mut tokens: Vec<PathToken> = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if matches!(byte, b'M' | b'L' | b'H' | b'V' | b'Q' | b'C' | b'Z') {
            tokens.push(PathToken::Command(char::from(byte)));
            cursor += 1;
            continue;
        }
        if let Some(end) = match_number_token(bytes, cursor) {
            if let Ok(value) = path_data[cursor..end].parse::<f64>() {
                tokens.push(PathToken::Number(value));
                cursor = end;
                continue;
            }
        }
        cursor += 1;
    }
    tokens
}

fn param_count(command: char) -> Option<usize> {
    match command {
        'M' | 'L' => Some(2),
        'H' | 'V' => Some(1),
        'Q' => Some(4),
        'C' => Some(6),
        'Z' => Some(0),
        _ => None,
    }
}

struct PathCursor {
    current_x: f64,
    current_y: f64,
    subpath_start_x: f64,
    subpath_start_y: f64,
}

struct BBoxAccumulator {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl BBoxAccumulator {
    fn visit(&mut self, x: f64, y: f64) {
        self.min_x = self.min_x.min(x);
        self.max_x = self.max_x.max(x);
        self.min_y = self.min_y.min(y);
        self.max_y = self.max_y.max(y);
    }
}

/// Compute the control-polygon bbox of absolute path data, or `None` when
/// the data is empty or contains an unknown/incomplete command.
#[must_use]
pub fn parse_path_bbox(path_data: &str) -> Option<BBox> {
    let tokens = tokenize(path_data);
    if tokens.is_empty() {
        return None;
    }

    let mut accumulator = BBoxAccumulator {
        min_x: f64::INFINITY,
        min_y: f64::INFINITY,
        max_x: f64::NEG_INFINITY,
        max_y: f64::NEG_INFINITY,
    };
    let mut cursor = PathCursor {
        current_x: 0.0,
        current_y: 0.0,
        subpath_start_x: 0.0,
        subpath_start_y: 0.0,
    };

    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index];
        index += 1;
        let command = match token {
            PathToken::Command(command) => command,
            // A stray number where a command is expected fails the parse
            // (TS getParamCount returns -1 for non-command tokens).
            PathToken::Number(_) => return None,
        };
        let count = param_count(command)?;
        let mut params = [0.0_f64; 6];
        for slot in params.iter_mut().take(count) {
            match tokens.get(index) {
                Some(PathToken::Number(value)) => *slot = *value,
                // TS parseFloat of a command token (or exhaustion) is NaN.
                _ => return None,
            }
            index += 1;
        }
        apply_command(command, &params, &mut cursor, &mut accumulator);
    }

    if !(accumulator.min_x.is_finite()
        && accumulator.min_y.is_finite()
        && accumulator.max_x.is_finite()
        && accumulator.max_y.is_finite())
    {
        return None;
    }

    Some(BBox {
        x: accumulator.min_x,
        y: accumulator.min_y,
        w: accumulator.max_x - accumulator.min_x,
        h: accumulator.max_y - accumulator.min_y,
    })
}

fn apply_command(
    command: char,
    params: &[f64; 6],
    cursor: &mut PathCursor,
    accumulator: &mut BBoxAccumulator,
) {
    match command {
        'M' | 'L' => {
            accumulator.visit(params[0], params[1]);
            cursor.current_x = params[0];
            cursor.current_y = params[1];
            if command == 'M' {
                cursor.subpath_start_x = params[0];
                cursor.subpath_start_y = params[1];
            }
        }
        'H' => {
            accumulator.visit(params[0], cursor.current_y);
            cursor.current_x = params[0];
        }
        'V' => {
            accumulator.visit(cursor.current_x, params[0]);
            cursor.current_y = params[0];
        }
        'Q' => {
            accumulator.visit(params[0], params[1]);
            accumulator.visit(params[2], params[3]);
            cursor.current_x = params[2];
            cursor.current_y = params[3];
        }
        'C' => {
            accumulator.visit(params[0], params[1]);
            accumulator.visit(params[2], params[3]);
            accumulator.visit(params[4], params[5]);
            cursor.current_x = params[4];
            cursor.current_y = params[5];
        }
        _ => {
            // 'Z' — close the subpath.
            cursor.current_x = cursor.subpath_start_x;
            cursor.current_y = cursor.subpath_start_y;
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_the_bbox_of_a_rectangle_path() {
        let bbox = parse_path_bbox("M1,2 L11,2 L11,22 L1,22 Z").expect("bbox");
        assert_eq!((bbox.x, bbox.y, bbox.w, bbox.h), (1.0, 2.0, 10.0, 20.0));
    }

    #[test]
    fn includes_curve_control_points() {
        let bbox = parse_path_bbox("M0,0 Q5,-10 10,0").expect("bbox");
        assert_eq!((bbox.y, bbox.h), (-10.0, 10.0));
    }

    #[test]
    fn returns_none_for_empty_or_invalid_data() {
        assert!(parse_path_bbox("").is_none());
        assert!(parse_path_bbox("A1,2").is_none());
        assert!(parse_path_bbox("M1").is_none());
    }

    #[test]
    fn tokenizes_exponents_and_bare_fractions() {
        let bbox = parse_path_bbox("M-.5,1e2 L.5,-1E-2").expect("bbox");
        assert_eq!((bbox.x, bbox.w), (-0.5, 1.0));
        assert_eq!((bbox.y, bbox.h), (-0.01, 100.01));
    }
}
