//! Serialize- and deserialize-direction schemas for the public IR boundary.
//!
//! This module is available only to the schema generation tool. It is not
//! compiled into the default native or WASM engine.

use std::collections::BTreeMap;
use std::fmt;

use schemars::generate::SchemaSettings;

use crate::EmitIrInput;
use crate::ir::types::StructuralIr;

/// Version of the deterministic schema normalization applied after Schemars.
pub const NORMALIZATION_VERSION: u32 = 2;

/// Reviewed wire presence rows that determine omitted output Option fields.
const OPTION_INVENTORY: &str = include_str!("../tests/fixtures/wire-option-contract.golden.txt");

#[derive(Debug)]
/// Invalid schema shape, unsupported format, or JSON conversion during generation.
pub struct IrSchemaGenerationError(String);

impl fmt::Display for IrSchemaGenerationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for IrSchemaGenerationError {}

impl From<serde_json::Error> for IrSchemaGenerationError {
    fn from(error: serde_json::Error) -> Self {
        Self(error.to_string())
    }
}

#[derive(Clone, Debug)]
/// One omit-none field named by its Rust owner and serialized property.
struct OmittedOptionField {
    owner: String,
    wire_field: String,
}

/// Pair of directional IR schemas generated from the actual Rust graph.
pub struct IrSchemas {
    /// Deterministic normalization revision used by generated-file receipts.
    pub normalization_version: u32,
    /// Required serialize-direction output fields and omission/null semantics.
    pub structural_ir: serde_json::Value,
    /// Deserialize-direction input domain, including ignored derived metadata.
    pub emit_ir_input: serde_json::Value,
}

/// Generate the serialize contract for `Ir` and deserialize contract for
/// `EmitIrInput` without conflating the two directions.
/// # Errors
///
/// Returns an error if the generated schema cannot be converted to JSON.
pub fn generate_ir_schemas() -> Result<IrSchemas, IrSchemaGenerationError> {
    let output_schema = SchemaSettings::draft2020_12()
        .for_serialize()
        .into_generator()
        .into_root_schema_for::<StructuralIr<'static>>();
    let emit_input_schema = SchemaSettings::draft2020_12()
        .for_deserialize()
        .into_generator()
        .into_root_schema_for::<EmitIrInput>();

    let mut structural_ir = serde_json::to_value(output_schema)?;
    let mut emit_ir_input = serde_json::to_value(emit_input_schema)?;
    normalize_output_schema(&mut structural_ir)?;
    normalize_numeric_formats(&mut emit_ir_input)?;

    Ok(IrSchemas {
        normalization_version: NORMALIZATION_VERSION,
        structural_ir,
        emit_ir_input,
    })
}

/// Read only omit-none inventory rows.
///
/// # Errors
///
/// Returns a generation error for a row with an unexpected column count.
fn omitted_option_fields() -> Result<Vec<OmittedOptionField>, IrSchemaGenerationError> {
    OPTION_INVENTORY
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| {
            let columns: Vec<_> = line.split('\t').collect();
            if columns.len() != 6 {
                return Some(Err(IrSchemaGenerationError(format!(
                    "invalid wire Option inventory row: {line}"
                ))));
            }
            (columns[5] == "omit-none").then(|| {
                Ok(OmittedOptionField {
                    owner: columns[2].to_string(),
                    wire_field: columns[4].to_string(),
                })
            })
        })
        .collect()
}

/// Match borrowed wire output owners to their Schemars definition names.
fn output_schema_owner(owner: &str) -> &str {
    match owner {
        "HandlersRefOutput" => "HandlersRef",
        "TextOutlinePathOutput" => "TextOutlinePath",
        "ShapePartPaintOutput" => "ShapePartPaint",
        "ShapePathPartOutput" => "ShapePathPart",
        "AnimationTransform2DOutput" => "AnimationTransform2D",
        "AnimationKeyframeOutput" => "AnimationKeyframe",
        "AnimationSpringOutput" => "AnimationSpring",
        "AnimationStepsOutput" => "AnimationSteps",
        "AnimationSpecOutput" => "AnimationSpec",
        "TextUnitAnimationOutput" => "TextUnitAnimation",
        "TextUnitAnimationSampleOutput" => "TextUnitAnimationSample",
        "IrNodeOutput" => "IrNode",
        "AnimationEasingOutput" => "AnimationEasing",
        "IrNodeKindOutput" => "IrNodeKind",
        _ => owner,
    }
}

/// Preserve omitted presence while allowing only required empty Path bounds to be null.
///
/// # Errors
///
/// Returns a generation error for missing definitions/properties, invalid
/// omit-none presence, unsupported numeric formats, or unreviewed output nulls.
fn normalize_output_schema(schema: &mut serde_json::Value) -> Result<(), IrSchemaGenerationError> {
    let omitted_fields = omitted_option_fields()?;
    let mut owners: BTreeMap<&str, Vec<&OmittedOptionField>> = BTreeMap::new();
    for field in &omitted_fields {
        owners.entry(&field.owner).or_default().push(field);
    }

    normalize_struct_fields(
        schema,
        "StructuralIr",
        owners.get("StructuralIr").into_iter().flatten().copied(),
    )?;

    let definitions = schema
        .get_mut("$defs")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or_else(|| {
            IrSchemaGenerationError("output IR schema has no $defs object".to_string())
        })?;

    for (owner, fields) in &owners {
        let Some((base_owner, variant)) = owner.split_once("::") else {
            if *owner == "StructuralIr" {
                continue;
            }
            if let Some(definition) = definitions.get_mut(output_schema_owner(owner)) {
                normalize_struct_fields(definition, owner, fields.iter().copied())?;
            }
            continue;
        };

        let base_schema_owner = output_schema_owner(base_owner);
        let definition_name = if base_schema_owner == "IrNodeKind" {
            "IrNode"
        } else {
            base_schema_owner
        };
        let Some(definition) = definitions.get_mut(definition_name) else {
            continue;
        };
        let variant_name = variant.to_ascii_lowercase();
        let variant_schema =
            find_tagged_variant_mut(definition, &variant_name).ok_or_else(|| {
                IrSchemaGenerationError(format!(
                    "schema definition {definition_name} has no tagged variant {variant_name}"
                ))
            })?;
        normalize_struct_fields(variant_schema, owner, fields.iter().copied())?;
    }

    normalize_numeric_formats(schema)?;
    // Empty Path paint has an explicit required null, rather than an omitted
    // layout substitute. All other output nulls remain prohibited.
    let mut non_nullable_output = schema.clone();
    let bounds = non_nullable_output
        .pointer_mut("/$defs/PathGeometry/properties/bounds")
        .ok_or_else(|| {
            IrSchemaGenerationError("PathGeometry bounds schema is missing".to_string())
        })?;
    if !contains_null_schema(bounds) {
        return Err(IrSchemaGenerationError(
            "PathGeometry empty bounds must allow null".to_string(),
        ));
    }
    *bounds = serde_json::json!({});
    if contains_null_schema_deep(&non_nullable_output) {
        return Err(IrSchemaGenerationError(
            "serialize-direction IR schema still contains a nullable field".to_string(),
        ));
    }
    Ok(())
}

/// Remove null only from inventoried optional properties without making them required.
///
/// # Errors
///
/// Returns a generation error for malformed object schemas, missing properties,
/// a required omit-none field, or a nullable field that cannot be normalized.
fn normalize_struct_fields<'a>(
    schema: &mut serde_json::Value,
    owner: &str,
    fields: impl Iterator<Item = &'a OmittedOptionField>,
) -> Result<(), IrSchemaGenerationError> {
    let object = schema
        .as_object_mut()
        .ok_or_else(|| IrSchemaGenerationError(format!("schema for {owner} is not an object")))?;
    let required: Vec<String> = object
        .get("required")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(str::to_string)
        .collect();
    let properties = object
        .get_mut("properties")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or_else(|| IrSchemaGenerationError(format!("schema for {owner} has no properties")))?;

    for field in fields {
        if required.contains(&field.wire_field) {
            return Err(IrSchemaGenerationError(format!(
                "omit-none field {owner}.{} is required in the serialize schema",
                field.wire_field
            )));
        }
        let property = properties.get_mut(&field.wire_field).ok_or_else(|| {
            IrSchemaGenerationError(format!(
                "omit-none field {owner}.{} is absent from its schema",
                field.wire_field
            ))
        })?;
        remove_null(property);
        if contains_null_schema(property) {
            return Err(IrSchemaGenerationError(format!(
                "omit-none field {owner}.{} remains nullable after normalization",
                field.wire_field
            )));
        }
    }
    Ok(())
}

/// Find a recursively nested object variant with the requested serialized type tag.
fn find_tagged_variant_mut<'a>(
    schema: &'a mut serde_json::Value,
    variant: &str,
) -> Option<&'a mut serde_json::Value> {
    if schema
        .get("properties")
        .and_then(|properties| properties.get("type"))
        .and_then(|tag| tag.get("const"))
        .and_then(serde_json::Value::as_str)
        == Some(variant)
    {
        return Some(schema);
    }
    match schema {
        serde_json::Value::Array(values) => values
            .iter_mut()
            .find_map(|value| find_tagged_variant_mut(value, variant)),
        serde_json::Value::Object(object) => object
            .values_mut()
            .find_map(|value| find_tagged_variant_mut(value, variant)),
        _ => None,
    }
}

/// Remove direct null alternatives from one omit-none property schema.
fn remove_null(schema: &mut serde_json::Value) {
    let Some(object) = schema.as_object_mut() else {
        return;
    };
    if let Some(values) = object
        .get_mut("enum")
        .and_then(serde_json::Value::as_array_mut)
    {
        values.retain(|value| !value.is_null());
    }
    if let Some(types) = object
        .get_mut("type")
        .and_then(serde_json::Value::as_array_mut)
    {
        types.retain(|kind| kind.as_str() != Some("null"));
        if types.len() == 1 {
            let single_type = types[0].clone();
            object.insert("type".to_string(), single_type);
        }
    }
    for keyword in ["anyOf", "oneOf"] {
        if let Some(variants) = object
            .get_mut(keyword)
            .and_then(serde_json::Value::as_array_mut)
        {
            variants.retain(|variant| {
                variant.get("type").and_then(serde_json::Value::as_str) != Some("null")
            });
        }
    }
}

/// Detect null in a property's direct type/enum/union alternatives.
fn contains_null_schema(schema: &serde_json::Value) -> bool {
    if schema
        .get("enum")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|values| values.iter().any(serde_json::Value::is_null))
    {
        return true;
    }
    if schema.get("type").and_then(serde_json::Value::as_str) == Some("null") {
        return true;
    }
    if schema
        .get("type")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|types| types.iter().any(|kind| kind.as_str() == Some("null")))
    {
        return true;
    }
    ["anyOf", "oneOf"].iter().any(|keyword| {
        schema
            .get(keyword)
            .and_then(serde_json::Value::as_array)
            .is_some_and(|variants| variants.iter().any(contains_null_schema))
    })
}

/// Detect remaining nullable output anywhere in a normalized schema graph.
fn contains_null_schema_deep(schema: &serde_json::Value) -> bool {
    if contains_null_schema(schema) {
        return true;
    }
    match schema {
        serde_json::Value::Array(values) => values.iter().any(contains_null_schema_deep),
        serde_json::Value::Object(object) => object.values().any(contains_null_schema_deep),
        _ => false,
    }
}

/// Strip reviewed Rust numeric format hints without weakening JSON number types.
///
/// # Errors
///
/// Returns a generation error if a newly introduced numeric format lacks review.
fn normalize_numeric_formats(
    schema: &mut serde_json::Value,
) -> Result<(), IrSchemaGenerationError> {
    match schema {
        serde_json::Value::Array(values) => {
            for value in values {
                normalize_numeric_formats(value)?;
            }
        }
        serde_json::Value::Object(object) => {
            if let Some(format) = object.get("format").and_then(serde_json::Value::as_str) {
                if !["double", "uint", "uint16", "uint32"].contains(&format) {
                    return Err(IrSchemaGenerationError(format!(
                        "unreviewed schema format {format}"
                    )));
                }
                object.remove("format");
            }
            for value in object.values_mut() {
                normalize_numeric_formats(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}
