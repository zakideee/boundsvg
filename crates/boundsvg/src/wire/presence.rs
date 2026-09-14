//! Preserve omission while rejecting null on optional non-null input fields.

use serde::{Deserialize, Deserializer};

/// Deserialize a present value; the field's default handles omission.
///
/// # Errors
///
/// Return the value type's decode failure, including its rejection of null.
pub(crate) fn deserialize_optional_non_null<'de, D, T>(
    deserializer: D,
) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}
