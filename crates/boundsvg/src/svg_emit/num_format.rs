//! ECMAScript-compatible number formatting for SVG attribute values.
//!
//! Reproduces the frozen contract in
//! `fixtures/conformance/num-format-cases.json` byte-for-byte, mirroring
//! `String(number)` (shortest round-trip decimal with the JS exponent
//! thresholds) and `formatNumber` in `packages/core/src/svg/utils.ts`
//! (precision rounding with the non-finite guard and the `f64::MAX`
//! overflow fallback).

use crate::error::EngineError;

/// ECMAScript `String(number)`.
///
/// Shortest round-trip decimal representation with exponent notation
/// outside `[1e-6, 1e21)`; `-0` formats as `"0"`.
#[must_use]
pub fn format_js_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }

    let magnitude = value.abs();
    // Rust's exponential formatting is the shortest round-trip decimal:
    // exactly the digits ECMA-262 Number::toString(10) starts from.
    let exponential = format!("{magnitude:e}");
    let (mantissa, exponent_text) = exponential
        .split_once('e')
        .unwrap_or((exponential.as_str(), "0"));
    let digits: String = mantissa.chars().filter(|ch| *ch != '.').collect();
    // Shortest f64 decimals stay far below i32 range (17 significant digits)
    let digit_count = i32::try_from(digits.len()).unwrap_or(i32::MAX);
    let exponent: i32 = exponent_text.parse().unwrap_or(0);
    // ECMA notation: value = digits × 10^(point - digit_count)
    let point = exponent + 1;

    let unsigned = if digit_count <= point && point <= 21 {
        // Integer with trailing zeros
        let mut rendered = digits;
        rendered.extend(std::iter::repeat_n(
            '0',
            usize::try_from(point - digit_count).unwrap_or(0),
        ));
        rendered
    } else if 0 < point && point <= 21 {
        // Decimal point inside the digits
        let split = usize::try_from(point).unwrap_or(0);
        format!("{}.{}", &digits[..split], &digits[split..])
    } else if -6 < point && point <= 0 {
        // Leading zeros after "0."
        let zeros: String =
            std::iter::repeat_n('0', usize::try_from(-point).unwrap_or(0)).collect();
        format!("0.{zeros}{digits}")
    } else {
        // Exponent notation
        let exponent_value = point - 1;
        let exponent_sign = if exponent_value >= 0 { "+" } else { "-" };
        let exponent_abs = exponent_value.abs();
        if digits.len() == 1 {
            format!("{digits}e{exponent_sign}{exponent_abs}")
        } else {
            format!(
                "{}.{}e{exponent_sign}{exponent_abs}",
                &digits[..1],
                &digits[1..]
            )
        }
    };

    if value < 0.0 {
        format!("-{unsigned}")
    } else {
        unsigned
    }
}

/// ECMAScript `Math.round`: nearest integer, ties toward positive infinity.
fn js_math_round(value: f64) -> f64 {
    let floored = value.floor();
    if value - floored < 0.5 {
        floored
    } else {
        floored + 1.0
    }
}

/// Mirror of TS `formatNumber(n, precision)`: round to `precision` decimal
/// places, then format via [`format_js_number`]. Rounding that overflows to
/// infinity near `f64::MAX` falls back to the unrounded value.
///
/// # Errors
///
/// Returns `EngineError::Rasterize`-free validation error for non-finite
/// input, matching the TS `FatalError("INVALID_NUMBER", ...)` guard.
pub fn round_number(value: f64, precision: u32) -> Result<f64, EngineError> {
    if !value.is_finite() {
        return Err(EngineError::Structured {
            code: "INVALID_NUMBER".to_string(),
            message: format!(
                "Cannot emit non-finite number to SVG: {}",
                format_js_number(value)
            ),
            stage: Some(crate::diagnostics::PipelineStage::Emit),
            node_id: None,
        });
    }
    let factor = 10f64.powi(i32::try_from(precision).unwrap_or(i32::MAX));
    let rounded = js_math_round(value * factor) / factor;
    Ok(if rounded.is_finite() { rounded } else { value })
}

/// Mirror of TS `formatNumber(n, precision)`.
///
/// # Errors
///
/// Returns an error for non-finite input.
pub fn format_number(value: f64, precision: u32) -> Result<String, EngineError> {
    round_number(value, precision).map(format_js_number)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One fixture case: `(input, expected, expectedRound2, expectedRound4)`.
    /// Parsed untyped — serde derives in this crate are inventoried by the
    /// WASM bridge schema guard, and test fixtures are not bridge DTOs.
    fn load_fixture_cases() -> Vec<(String, String, String, String)> {
        let fixture_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/conformance/num-format-cases.json"
        );
        let fixture_text =
            std::fs::read_to_string(fixture_path).expect("num-format fixture should exist");
        let fixture: serde_json::Value =
            serde_json::from_str(&fixture_text).expect("num-format fixture should parse");
        let case_field = |case: &serde_json::Value, key: &str| -> String {
            case[key]
                .as_str()
                .unwrap_or_else(|| panic!("fixture case field {key} should be a string"))
                .to_string()
        };
        fixture["cases"]
            .as_array()
            .expect("fixture cases should be an array")
            .iter()
            .map(|case| {
                (
                    case_field(case, "input"),
                    case_field(case, "expected"),
                    case_field(case, "expectedRound2"),
                    case_field(case, "expectedRound4"),
                )
            })
            .collect()
    }

    #[test]
    fn reproduces_every_fixture_column() {
        let cases = load_fixture_cases();
        assert!(cases.len() >= 50);
        for (input, expected, expected_round2, expected_round4) in &cases {
            let value: f64 = input
                .parse()
                .unwrap_or_else(|_| panic!("input parses as f64: {input}"));
            assert_eq!(format_js_number(value), *expected, "String({input})");
            assert_eq!(
                format_number(value, 2).expect("finite round2"),
                *expected_round2,
                "formatNumber({input}, 2)"
            );
            assert_eq!(
                format_number(value, 4).expect("finite round4"),
                *expected_round4,
                "formatNumber({input}, 4)"
            );
        }
    }

    #[test]
    fn rejects_non_finite_input_like_the_ts_guard() {
        assert!(format_number(f64::NAN, 2).is_err());
        assert!(format_number(f64::INFINITY, 2).is_err());
        assert!(format_number(f64::NEG_INFINITY, 4).is_err());
    }

    #[test]
    fn formats_non_finite_via_string_semantics() {
        // transformToSvg formats via String() without a guard
        assert_eq!(format_js_number(f64::NAN), "NaN");
        assert_eq!(format_js_number(f64::INFINITY), "Infinity");
        assert_eq!(format_js_number(f64::NEG_INFINITY), "-Infinity");
    }
}
