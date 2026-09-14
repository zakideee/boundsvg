//! Validate numeric leaves while constructing an output, without materializing JSON.
//!
//! The validator follows the actual derived projection, so nested geometry and
//! text values cannot escape a hand-maintained numeric-field list. Map keys never
//! become diagnostics; only static struct field names are retained.

use std::fmt;

use serde::Serialize;
use serde::ser::{
    self, SerializeMap, SerializeSeq, SerializeStruct, SerializeStructVariant, SerializeTuple,
    SerializeTupleStruct, SerializeTupleVariant,
};

/// Failure to construct an output projection suitable for JSON transport.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OutputConstructionError {
    NonFinite { field: &'static str },
    Serialization,
}

impl OutputConstructionError {
    /// Attach the calling export to a typed output-construction failure.
    pub(crate) fn into_engine_error(self, operation: &'static str) -> crate::error::EngineError {
        match self {
            Self::NonFinite { field } => crate::error::EngineError::StructuredContext {
                code: "WASM_NON_FINITE_OUTPUT".to_string(),
                message: "WASM output contains a non-finite number.".to_string(),
                stage: Some(crate::diagnostics::PipelineStage::Wasm),
                node_id: None,
                context: Box::new(serde_json::json!({ "operation": operation, "field": field })),
            },
            Self::Serialization => crate::error::EngineError::Validation(self.to_string()),
        }
    }
}

impl fmt::Display for OutputConstructionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NonFinite { .. } => {
                formatter.write_str("WASM output contains a non-finite number.")
            }
            Self::Serialization => {
                formatter.write_str("Output projection could not be serialized.")
            }
        }
    }
}

impl std::error::Error for OutputConstructionError {}

impl ser::Error for OutputConstructionError {
    fn custom<T: fmt::Display>(_message: T) -> Self {
        Self::Serialization
    }
}

/// An immutable output whose complete projected numeric graph is finite.
pub(crate) struct FiniteOutput<T> {
    projection: T,
}

impl<T: Serialize> FiniteOutput<T> {
    /// Construct the output only after checking its actual serialization shape.
    ///
    /// # Errors
    ///
    /// Returns a typed failure for a non-finite leaf or an invalid projection.
    pub(crate) fn try_new(projection: T) -> Result<Self, OutputConstructionError> {
        projection.serialize(FiniteNumberValidator { field: "output" })?;
        Ok(Self { projection })
    }
}

impl<T: Serialize> Serialize for FiniteOutput<T> {
    fn serialize<S: ser::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.projection.serialize(serializer)
    }
}

#[derive(Clone, Copy)]
struct FiniteNumberValidator {
    field: &'static str,
}

impl ser::Serializer for FiniteNumberValidator {
    type Ok = ();
    type Error = OutputConstructionError;
    type SerializeSeq = Self;
    type SerializeTuple = Self;
    type SerializeTupleStruct = Self;
    type SerializeTupleVariant = Self;
    type SerializeMap = Self;
    type SerializeStruct = Self;
    type SerializeStructVariant = Self;
    fn serialize_bool(self, _leaf: bool) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_i8(self, _leaf: i8) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_i16(self, _leaf: i16) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_i32(self, _leaf: i32) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_i64(self, _leaf: i64) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_i128(self, _leaf: i128) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_u8(self, _leaf: u8) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_u16(self, _leaf: u16) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_u32(self, _leaf: u32) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_u64(self, _leaf: u64) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_u128(self, _leaf: u128) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_char(self, _leaf: char) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_str(self, _leaf: &str) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_bytes(self, _leaf: &[u8]) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_f32(self, number: f32) -> Result<(), Self::Error> {
        if number.is_finite() {
            Ok(())
        } else {
            Err(OutputConstructionError::NonFinite { field: self.field })
        }
    }
    fn serialize_f64(self, number: f64) -> Result<(), Self::Error> {
        if number.is_finite() {
            Ok(())
        } else {
            Err(OutputConstructionError::NonFinite { field: self.field })
        }
    }
    fn serialize_none(self) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_some<T: ?Sized + Serialize>(self, nested: &T) -> Result<(), Self::Error> {
        nested.serialize(self)
    }
    fn serialize_unit(self) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_unit_struct(self, _name: &'static str) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _index: u32,
        _variant: &'static str,
    ) -> Result<(), Self::Error> {
        Ok(())
    }
    fn serialize_newtype_struct<T: ?Sized + Serialize>(
        self,
        _name: &'static str,
        nested: &T,
    ) -> Result<(), Self::Error> {
        nested.serialize(self)
    }
    fn serialize_newtype_variant<T: ?Sized + Serialize>(
        self,
        _name: &'static str,
        _index: u32,
        _variant: &'static str,
        nested: &T,
    ) -> Result<(), Self::Error> {
        nested.serialize(self)
    }
    fn serialize_seq(self, _length: Option<usize>) -> Result<Self, Self::Error> {
        Ok(self)
    }
    fn serialize_tuple(self, _length: usize) -> Result<Self, Self::Error> {
        Ok(self)
    }
    fn serialize_tuple_struct(
        self,
        _name: &'static str,
        _length: usize,
    ) -> Result<Self, Self::Error> {
        Ok(self)
    }
    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _index: u32,
        _variant: &'static str,
        _length: usize,
    ) -> Result<Self, Self::Error> {
        Ok(self)
    }
    fn serialize_map(self, _length: Option<usize>) -> Result<Self, Self::Error> {
        Ok(self)
    }
    fn serialize_struct(self, _name: &'static str, _length: usize) -> Result<Self, Self::Error> {
        Ok(self)
    }
    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _index: u32,
        _variant: &'static str,
        _length: usize,
    ) -> Result<Self, Self::Error> {
        Ok(self)
    }
    fn collect_str<T: ?Sized + fmt::Display>(self, _display: &T) -> Result<(), Self::Error> {
        Ok(())
    }
}

impl SerializeSeq for FiniteNumberValidator {
    type Ok = ();
    type Error = OutputConstructionError;
    fn serialize_element<T: ?Sized + Serialize>(&mut self, nested: &T) -> Result<(), Self::Error> {
        nested.serialize(*self)
    }
    fn end(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

impl SerializeTuple for FiniteNumberValidator {
    type Ok = ();
    type Error = OutputConstructionError;
    fn serialize_element<T: ?Sized + Serialize>(&mut self, nested: &T) -> Result<(), Self::Error> {
        nested.serialize(*self)
    }
    fn end(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

impl SerializeTupleStruct for FiniteNumberValidator {
    type Ok = ();
    type Error = OutputConstructionError;
    fn serialize_field<T: ?Sized + Serialize>(&mut self, nested: &T) -> Result<(), Self::Error> {
        nested.serialize(*self)
    }
    fn end(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

impl SerializeTupleVariant for FiniteNumberValidator {
    type Ok = ();
    type Error = OutputConstructionError;
    fn serialize_field<T: ?Sized + Serialize>(&mut self, nested: &T) -> Result<(), Self::Error> {
        nested.serialize(*self)
    }
    fn end(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

impl SerializeMap for FiniteNumberValidator {
    type Ok = ();
    type Error = OutputConstructionError;
    fn serialize_key<T: ?Sized + Serialize>(&mut self, key: &T) -> Result<(), Self::Error> {
        key.serialize(*self)
    }
    fn serialize_value<T: ?Sized + Serialize>(&mut self, nested: &T) -> Result<(), Self::Error> {
        nested.serialize(*self)
    }
    fn end(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

impl SerializeStruct for FiniteNumberValidator {
    type Ok = ();
    type Error = OutputConstructionError;
    fn serialize_field<T: ?Sized + Serialize>(
        &mut self,
        key: &'static str,
        nested: &T,
    ) -> Result<(), Self::Error> {
        nested.serialize(Self { field: key })
    }
    fn end(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

impl SerializeStructVariant for FiniteNumberValidator {
    type Ok = ();
    type Error = OutputConstructionError;
    fn serialize_field<T: ?Sized + Serialize>(
        &mut self,
        key: &'static str,
        nested: &T,
    ) -> Result<(), Self::Error> {
        nested.serialize(Self { field: key })
    }
    fn end(self) -> Result<(), Self::Error> {
        Ok(())
    }
}
