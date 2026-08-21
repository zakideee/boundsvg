//! Schema-only helpers for directional serde contracts.

use std::borrow::Cow;
use std::marker::PhantomData;

use schemars::{JsonSchema, Schema, SchemaGenerator};

/// Describe a field as `Output` for serialization and `Input` for
/// deserialization while leaving its runtime Rust storage type unchanged.
pub struct DirectionalSchema<Output, Input>(PhantomData<(Output, Input)>);

impl<Output: JsonSchema, Input: JsonSchema> JsonSchema for DirectionalSchema<Output, Input> {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> Cow<'static, str> {
        format!(
            "DirectionalSchema_{}_{}",
            Output::schema_name(),
            Input::schema_name()
        )
        .into()
    }

    fn schema_id() -> Cow<'static, str> {
        format!(
            "{}::DirectionalSchema<{},{}>",
            module_path!(),
            Output::schema_id(),
            Input::schema_id()
        )
        .into()
    }

    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        if generator.contract().is_serialize() {
            Output::json_schema(generator)
        } else {
            Input::json_schema(generator)
        }
    }
}

/// String-literal domain used by [`StringEnumSchema`].
pub trait StringEnumSchemaDomain {
    const NAME: &'static str;
    const VALUES: &'static [&'static str];
}

/// Schema-only string enum whose literals are declared by `Domain` without
/// introducing runtime enum variants that can never be constructed.
pub struct StringEnumSchema<Domain>(PhantomData<Domain>);

impl<Domain: StringEnumSchemaDomain> JsonSchema for StringEnumSchema<Domain> {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> Cow<'static, str> {
        format!("StringEnumSchema_{}", Domain::NAME).into()
    }

    fn schema_id() -> Cow<'static, str> {
        format!(
            "{}::StringEnumSchema<{}>",
            module_path!(),
            std::any::type_name::<Domain>()
        )
        .into()
    }

    fn json_schema(_generator: &mut SchemaGenerator) -> Schema {
        schemars::json_schema!({
            "type": "string",
            "enum": Domain::VALUES,
        })
    }
}
