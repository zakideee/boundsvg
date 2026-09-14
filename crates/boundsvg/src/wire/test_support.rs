//! Runtime field checks shared by surface-local DTO fixtures.

use serde::de::DeserializeOwned;
use serde_json::{Value, json};

/// Check real DTO presence, including field access after decoding.
///
/// # Panics
///
/// Panics when a fixture or presence contract is violated.
pub(crate) fn assert_optional_field<T: DeserializeOwned>(
    complete: &Value,
    field: &str,
    is_missing: impl Fn(&T) -> bool,
) {
    let present: T = serde_json::from_value(complete.clone()).expect("valid complete DTO");
    assert!(!is_missing(&present), "{field}: present value was lost");

    let mut omitted = complete.clone();
    omitted.as_object_mut().expect("DTO object").remove(field);
    let absent: T = serde_json::from_value(omitted).expect("optional omission");
    assert!(is_missing(&absent), "{field}: omission must remain absent");

    let mut explicit_null = complete.clone();
    explicit_null[field] = Value::Null;
    assert!(
        serde_json::from_value::<T>(explicit_null).is_err(),
        "{field}: null"
    );

    let mut wrong_type = complete.clone();
    wrong_type[field] = if complete[field].is_array() || complete[field].is_object() {
        json!(37)
    } else {
        json!({ "unexpected": true })
    };
    assert!(
        serde_json::from_value::<T>(wrong_type).is_err(),
        "{field}: wrong type"
    );
}

/// Check output omission and the canonical directional round trip.
///
/// # Panics
///
/// Panics when either real projection violates the fixture contract.
pub(crate) fn assert_output_round_trip<Input, Domain>(complete: &Value, fields: &[&str])
where
    Input: DeserializeOwned,
    Domain: From<Input> + serde::Serialize,
{
    let decoded: Input = serde_json::from_value(complete.clone()).expect("valid input projection");
    let produced = serde_json::to_value(Domain::from(decoded)).expect("output projection");
    let reread: Input = serde_json::from_value(produced.clone()).expect("output accepted as input");
    let reproduced = serde_json::to_value(Domain::from(reread)).expect("reproduced output");
    assert_eq!(produced, reproduced, "canonical wire round trip");
    for field in fields {
        assert!(
            produced
                .get(field)
                .is_some_and(|present| !present.is_null()),
            "{field}: value output"
        );
        let mut missing = complete.clone();
        missing
            .as_object_mut()
            .expect("input object")
            .remove(*field);
        let decoded: Input = serde_json::from_value(missing).expect("omitted input field");
        let omitted_output =
            serde_json::to_value(Domain::from(decoded)).expect("omitted output field");
        assert!(
            omitted_output.get(field).is_none(),
            "{field}: output omission"
        );
    }
}

/// Native numeric codec classes; algorithm domains are checked by their owners.
#[derive(Clone, Copy)]
pub(crate) enum NumericWireType {
    Float32,
    Float64,
    Unsigned16,
    Unsigned32,
    UnsignedSize,
    Signed16,
}

/// Check primitive codec limits while retaining every required sibling field.
///
/// # Panics
///
/// Panics when a numeric token changes the established codec boundary.
pub(crate) fn assert_numeric_field<T: DeserializeOwned>(
    fixture: &Value,
    field: &str,
    wire_type: NumericWireType,
) {
    let (accepted, rejected): (Vec<String>, Vec<String>) = match wire_type {
        NumericWireType::Float32 => (
            vec![
                "-0.0".into(),
                "0".into(),
                "1".into(),
                f32::MAX.to_string(),
                (-f32::MAX).to_string(),
            ],
            vec!["1e39".into(), "1e400".into()],
        ),
        NumericWireType::Float64 => (
            vec![
                "-0.0".into(),
                "0".into(),
                "1".into(),
                f64::MAX.to_string(),
                (-f64::MAX).to_string(),
            ],
            vec!["1e400".into()],
        ),
        NumericWireType::Unsigned16 => (
            vec!["0".into(), u16::MAX.to_string()],
            vec!["-1".into(), "0.5".into(), "65536".into()],
        ),
        NumericWireType::Unsigned32 => (
            vec!["0".into(), u32::MAX.to_string()],
            vec!["-1".into(), "0.5".into(), "4294967296".into()],
        ),
        NumericWireType::UnsignedSize => (
            vec!["0".into(), usize::MAX.to_string()],
            vec!["-1".into(), "0.5".into(), "18446744073709551616".into()],
        ),
        NumericWireType::Signed16 => (
            vec![i16::MIN.to_string(), "0".into(), i16::MAX.to_string()],
            vec!["-32769".into(), "32768".into(), "0.5".into()],
        ),
    };
    if matches!(wire_type, NumericWireType::Float32) {
        assert!(
            serde_json::from_str::<Option<f32>>("1e39").is_err(),
            "original Option<f32> codec rejects overflow"
        );
    }
    for token in &accepted {
        assert!(
            serde_json::from_str::<T>(&with_numeric_token(fixture, field, token)).is_ok(),
            "{field}: codec must accept {token}"
        );
    }
    for token in rejected
        .iter()
        .map(String::as_str)
        .chain(["NaN", "Infinity", "-Infinity"])
    {
        assert!(
            serde_json::from_str::<T>(&with_numeric_token(fixture, field, token)).is_err(),
            "{field}: codec must reject {token}"
        );
    }
}

fn with_numeric_token(fixture: &Value, field: &str, token: &str) -> String {
    let members = fixture
        .as_object()
        .expect("DTO object")
        .iter()
        .map(|(key, contents)| {
            let encoded_key = serde_json::to_string(key).expect("key JSON");
            let encoded_contents = if key == field {
                token.to_string()
            } else {
                serde_json::to_string(contents).expect("fixture JSON")
            };
            format!("{encoded_key}:{encoded_contents}")
        })
        .collect::<Vec<_>>();
    format!("{{{}}}", members.join(","))
}
